/**
 * Pay Bill — the product's core flow and its revenue line.
 *
 *   quote ─► create (idempotent, opens gateway order) ─► pay ─► captured
 *         ─► ledger posting + offer redemptions (one transaction)
 *         ─► live pass at the table ─► staff verify (or auto-verify)
 *
 * `priceBill` is called by both the quote and the create, with the same
 * inputs, so the amount a diner is shown is the amount they are charged.
 */
import { z } from 'zod';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';
import { query, queryOne, withTransaction, type Queryable } from '../../../db/pool';
import { BadRequestError, ConflictError, NotFoundError, PaymentError } from '../../../utils/errors';
import { readableCode } from '../../../utils/ids';
import { rupeesToPaise } from '../../../utils/money';
import { getSetting, getSettings } from '../../../services/settings.service';
import * as gateway from '../../../services/razorpay.provider';
import { registerPaymentSubject } from '../../payments/subjects';
import { bankReceivable, PLATFORM, post, restaurantPayable } from '../../finance/ledger';
import { DINING_TZ, toLocalMoment } from '../time';
import { offerIneligibility, priceBill, type BillPricing, type EngineOffer, type OfferMode } from '../offers/engine';
import { activeRestaurantOffers, bankOffersFor, findCoupon, reviveEngineOffer, toEngineOffer, usageFor } from '../offers/offer.service';
import { availableBalance, accrueCashback, captureForBill, holdForBill, releaseForBill } from '../../finance/wallet';
import { codeAt, newVerifySecret, STEP_SECONDS } from './verification';
import { TOPICS } from '../notifications';
import { createShares, MAX_SPLIT } from './split-shares';
import { enqueue, kickOutbox } from '../../platform/outbox';

/* ───────────────────────── input ───────────────────────── */

const rupees = z.coerce.number().min(0).max(1_000_000);

export const billInput = z
  .object({
    restaurantId: z.string().uuid(),
    billTotal: rupees.refine((value) => value >= 1, 'Enter your bill amount'),
    nonDiscountable: rupees.default(0),
    keepServiceCharge: z.boolean().default(false),
    tip: rupees.max(50_000).default(0),
    couponCode: z.string().trim().max(40).nullish(),
    reservationCode: z.string().trim().max(20).nullish(),
    /** The bank offer the diner will pay with (they pick the instrument at checkout). */
    bankOfferId: z.string().uuid().nullish(),
    /** Spend Tixit Wallet balance on this bill. */
    useWallet: z.boolean().default(false),
    /** Split the payable amount between this many people (1 = no split). */
    splitInto: z.coerce.number().int().min(1).max(MAX_SPLIT).default(1),
  })
  .refine((value) => value.nonDiscountable <= value.billTotal, {
    message: 'This cannot be more than the bill',
    path: ['nonDiscountable'],
  })
  // A bank offer is funded on one card; friends pay with their own.
  .refine((value) => value.splitInto === 1 || !value.bankOfferId, {
    message: 'Bank offers apply when one card pays the whole bill',
    path: ['bankOfferId'],
  });
export type BillInput = z.infer<typeof billInput>;

/* ───────────────────────── pricing ───────────────────────── */

interface BillingRestaurant {
  id: string;
  name: string;
  slug: string;
  status: string;
  pay_bill_enabled: boolean;
  service_charge_percent: string | number;
  commission_bps: number;
}

async function loadRestaurant(id: string, client: Queryable): Promise<BillingRestaurant> {
  const { rows } = await client.query<BillingRestaurant>(
    `SELECT id, name, slug, status, pay_bill_enabled, service_charge_percent, commission_bps
       FROM dining.restaurants WHERE id = $1`,
    [id],
  );
  const restaurant = rows[0];
  if (!restaurant) throw new NotFoundError('Restaurant');
  if (restaurant.status !== 'live' || !restaurant.pay_bill_enabled) {
    throw new ConflictError('This restaurant is not accepting payments on Tixit right now', 'PAY_BILL_UNAVAILABLE');
  }
  return restaurant;
}

/**
 * A reservation made today at this restaurant turns the bill into a pre-book
 * bill, carries its promised offer, and brings any table deposit to credit.
 */
async function loadReservation(code: string | null | undefined, userId: string | null, restaurantId: string, client: Queryable) {
  if (!code || !userId) return null;
  const { rows } = await client.query<{ id: string; offer_snapshot: unknown; cover_paise: number; cover_status: string }>(
    `SELECT id, offer_snapshot, cover_paise, cover_status FROM dining.reservations
      WHERE code = $1 AND user_id = $2 AND restaurant_id = $3
        AND status IN ('placed', 'confirmed', 'seated')
        AND (starts_at AT TIME ZONE '${DINING_TZ}')::date = (now() AT TIME ZONE '${DINING_TZ}')::date`,
    [code, userId, restaurantId],
  );
  return rows[0] ?? null;
}

interface PricingContext {
  restaurant: BillingRestaurant;
  reservationId: string | null;
  coverDepositPaise: number;
  bankOffer: EngineOffer | null;
  mode: OfferMode;
  pricing: BillPricing;
  bankOptions: Array<{ id: string; title: string; bankName: string | null; paymentMethods: string[]; unavailableReason: string | null }>;
  walletAvailablePaise: number;
}

async function price(input: BillInput, userId: string | null, client: Queryable): Promise<PricingContext> {
  const restaurant = await loadRestaurant(input.restaurantId, client);
  const reservation = await loadReservation(input.reservationCode, userId, restaurant.id, client);

  const offers = (await activeRestaurantOffers(restaurant.id, client)).map(toEngineOffer);
  const couponRow = input.couponCode ? await findCoupon(input.couponCode, restaurant.id, client) : null;
  const coupon = couponRow ? toEngineOffer(couponRow) : null;
  const promised = reservation ? reviveEngineOffer(reservation.offer_snapshot) : null;
  const bankRows = await bankOffersFor(restaurant.id, client);
  const bankRow = input.bankOfferId ? bankRows.find((row) => row.id === input.bankOfferId) : undefined;
  if (input.bankOfferId && !bankRow) throw new BadRequestError('That bank offer is not available here', 'BANK_OFFER_UNAVAILABLE');
  const bankOffer = bankRow ? toEngineOffer(bankRow) : null;

  const offerIds = [
    ...offers.map((offer) => offer.id),
    ...(coupon ? [coupon.id] : []),
    ...(promised ? [promised.id] : []),
    ...bankRows.map((row) => row.id),
  ];
  const usage = await usageFor(userId, offerIds, client);
  const settings = await getSettings(client);
  const mode: OfferMode = reservation ? 'prebook' : 'walkin';
  const walletAvailable = userId ? await availableBalance(userId, client) : 0;
  const coverDeposit = reservation && reservation.cover_status === 'paid' ? Number(reservation.cover_paise) : 0;
  const now = toLocalMoment(new Date());

  const pricing = priceBill({
    billTotalPaise: rupeesToPaise(input.billTotal),
    nonDiscountablePaise: rupeesToPaise(input.nonDiscountable),
    keepServiceCharge: input.keepServiceCharge,
    serviceChargePercent: Number(restaurant.service_charge_percent),
    tipPaise: rupeesToPaise(input.tip),
    mode,
    at: now,
    restaurantOffers: offers,
    promisedOffer: promised,
    coupon,
    couponCodeNotFound: input.couponCode && !couponRow ? input.couponCode : null,
    bankOffer,
    usage,
    coverDepositPaise: coverDeposit,
    walletAvailablePaise: input.useWallet ? walletAvailable : 0,
    walletMaxPercent: Number(settings.dining_wallet_max_redeem_percent),
    convenienceFeePaise: Number(settings.dining_convenience_fee_paise),
    commissionBps: restaurant.commission_bps,
  });

  const billPaise = rupeesToPaise(input.billTotal);
  return {
    restaurant,
    reservationId: reservation?.id ?? null,
    coverDepositPaise: coverDeposit,
    bankOffer,
    mode,
    pricing,
    walletAvailablePaise: walletAvailable,
    bankOptions: bankRows.map((row) => ({
      id: row.id,
      title: row.title,
      bankName: row.bank_name ?? null,
      paymentMethods: row.payment_methods ?? [],
      unavailableReason: offerIneligibility(toEngineOffer(row), { mode, at: now, billTotalPaise: billPaise, usage }),
    })),
  };
}

/** The receipt a diner sees before paying. Never shows platform economics. */
function publicPricing(pricing: BillPricing) {
  return {
    engineVersion: pricing.engineVersion,
    billTotalPaise: pricing.billTotalPaise,
    nonDiscountablePaise: pricing.nonDiscountablePaise,
    restaurantOffer: pricing.restaurantOffer
      ? { title: pricing.restaurantOffer.title, discountPaise: pricing.restaurantOffer.discountPaise }
      : null,
    coupon: pricing.coupon ? { code: pricing.coupon.code, title: pricing.coupon.title, discountPaise: pricing.coupon.discountPaise } : null,
    couponError: pricing.couponError,
    bankOffer: pricing.bankOffer
      ? { title: pricing.bankOffer.title, bankName: pricing.bankOffer.bankName ?? null, discountPaise: pricing.bankOffer.discountPaise }
      : null,
    bankOfferError: pricing.bankOfferError,
    coverCreditPaise: pricing.coverCreditPaise ?? 0,
    walletUsedPaise: pricing.walletUsedPaise ?? 0,
    serviceChargePaise: pricing.serviceChargePaise,
    tipPaise: pricing.tipPaise,
    convenienceFeePaise: pricing.convenienceFeePaise,
    totalDiscountPaise: pricing.totalDiscountPaise,
    amountPayablePaise: pricing.amountPayablePaise,
    lines: pricing.lines,
  };
}
export type PublicPricing = ReturnType<typeof publicPricing>;

export async function quoteBill(input: BillInput, userId: string | null) {
  const context = await price(input, userId, { query });
  return {
    mode: context.mode,
    ...publicPricing(context.pricing),
    bankOptions: context.bankOptions,
    walletAvailablePaise: context.walletAvailablePaise,
    coverDepositPaise: context.coverDepositPaise,
  };
}

/* ───────────────────────── create & pay ───────────────────────── */

export interface BillCheckout {
  code: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string | null;
  mockMode: boolean;
  mockPaymentId?: string;
  mockSignature?: string;
  restaurantName: string;
  prefill: { name: string; email: string; contact: string };
}

async function checkoutFor(billId: string): Promise<BillCheckout> {
  const row = await queryOne<{
    code: string;
    amount_payable_paise: number;
    status: string;
    restaurant_name: string;
    full_name: string;
    email: string;
    phone: string | null;
    provider_order_id: string | null;
  }>(
    `SELECT b.code, b.amount_payable_paise, b.status, r.name AS restaurant_name, u.full_name, u.email, u.phone,
            (SELECT p.provider_order_id FROM payments p
              WHERE p.bill_payment_id = b.id AND p.status IN ('created', 'pending')
              ORDER BY p.created_at DESC LIMIT 1) AS provider_order_id
       FROM dining.bill_payments b
       JOIN dining.restaurants r ON r.id = b.restaurant_id
       JOIN users u ON u.id = b.user_id
      WHERE b.id = $1`,
    [billId],
  );
  if (!row) throw new NotFoundError('Bill');
  if (row.status !== 'pending_payment') throw new ConflictError('This bill has already been paid', 'BILL_NOT_PENDING');

  let orderId = row.provider_order_id;
  if (!orderId) {
    const order = await gateway.createOrder({
      amountPaise: Number(row.amount_payable_paise),
      receipt: row.code,
      notes: { billCode: row.code, product: 'dinein' },
    });
    orderId = order.id;
    await query(
      `INSERT INTO payments (bill_payment_id, provider, provider_order_id, amount_paise, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'created')`,
      [billId, gateway.isMockMode ? 'mock' : 'razorpay', orderId, row.amount_payable_paise, env.razorpay.currency],
    );
  }

  const session: BillCheckout = {
    code: row.code,
    orderId,
    amountPaise: Number(row.amount_payable_paise),
    currency: env.razorpay.currency,
    keyId: env.razorpay.keyId ?? null,
    mockMode: gateway.isMockMode,
    restaurantName: row.restaurant_name,
    prefill: { name: row.full_name, email: row.email, contact: row.phone ?? '' },
  };
  if (gateway.isMockMode) {
    session.mockPaymentId = `pay_mock_${orderId.slice(-12)}`;
    session.mockSignature = gateway.mockSignature(orderId, session.mockPaymentId);
  }
  return session;
}

/**
 * Freeze the price and open a gateway order.
 *
 * `idempotencyKey` (the Idempotency-Key header) makes a double tap or a retry
 * after a dropped connection return the same bill instead of a second one.
 */
/** A split bill has no single order: the host lands on the split screen instead. */
export type CreatedBill = BillCheckout | { code: string; split: true };

async function resultFor(billId: string): Promise<CreatedBill> {
  const bill = await queryOne<{ code: string; split_count: number }>('SELECT code, split_count FROM dining.bill_payments WHERE id = $1', [billId]);
  if (bill && bill.split_count > 1) return { code: bill.code, split: true };
  return checkoutFor(billId);
}

export async function createBill(userId: string, input: BillInput, idempotencyKey: string | null): Promise<CreatedBill> {
  if (idempotencyKey) {
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM dining.bill_payments WHERE user_id = $1 AND idempotency_key = $2',
      [userId, idempotencyKey],
    );
    if (existing) return resultFor(existing.id);
  }

  const billId = await withTransaction(async (client) => {
    const { restaurant, reservationId, pricing, bankOffer } = await price(input, userId, client);
    if (input.couponCode && pricing.couponError) {
      throw new BadRequestError(pricing.couponError, 'COUPON_INVALID');
    }
    if (input.bankOfferId && pricing.bankOfferError) {
      throw new BadRequestError(pricing.bankOfferError, 'BANK_OFFER_INVALID');
    }
    if (pricing.amountPayablePaise <= 0) throw new BadRequestError('Nothing to pay on this bill', 'NOTHING_TO_PAY');

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO dining.bill_payments (
         code, user_id, restaurant_id, reservation_id, status, idempotency_key, bill_total_paise,
         non_discountable_paise, service_charge_paise, tip_paise, pricing, restaurant_discount_paise,
         platform_discount_paise, convenience_fee_paise, amount_payable_paise, commission_base_paise,
         commission_paise, commission_gst_paise, restaurant_payout_paise, verify_secret, wallet_used_paise,
         cover_credit_paise, bank_discount_paise, bank_offer_id)
       VALUES ($1, $2, $3, $4, 'pending_payment', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
               $20, $21, $22, $23)
       ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        `BIL-${readableCode(6)}`,
        userId,
        restaurant.id,
        reservationId,
        idempotencyKey,
        pricing.billTotalPaise,
        pricing.nonDiscountablePaise,
        pricing.serviceChargePaise,
        pricing.tipPaise,
        JSON.stringify(pricing),
        pricing.restaurantFundedDiscountPaise,
        pricing.platformFundedDiscountPaise,
        pricing.convenienceFeePaise,
        pricing.amountPayablePaise,
        pricing.commissionBasePaise,
        pricing.commissionPaise,
        pricing.commissionGstPaise,
        pricing.restaurantPayoutPaise,
        newVerifySecret(),
        pricing.walletUsedPaise,
        pricing.coverCreditPaise,
        pricing.bankFundedDiscountPaise + (pricing.bankOffer?.restaurantSharePaise ?? 0),
        pricing.bankOffer ? bankOffer?.id ?? null : null,
      ],
    );
    if (rows[0]) {
      // Reserve the wallet money now so the quoted price is the charged price.
      await holdForBill(client, userId, rows[0].id, pricing.walletUsedPaise);
      if (input.splitInto > 1) await createShares(client, rows[0].id, pricing.amountPayablePaise, input.splitInto);
      return rows[0].id;
    }
    // A concurrent request with the same key won the insert.
    const { rows: raced } = await client.query<{ id: string }>(
      'SELECT id FROM dining.bill_payments WHERE user_id = $1 AND idempotency_key = $2',
      [userId, idempotencyKey],
    );
    return raced[0]!.id;
  });

  return resultFor(billId);
}

export async function verifyBillPayment(
  userId: string,
  code: string,
  input: { orderId: string; paymentId: string; signature: string },
): Promise<BillView> {
  const payment = await queryOne<{ id: string; bill_payment_id: string; status: string; user_id: string; bill_code: string }>(
    `SELECT p.id, p.bill_payment_id, p.status, b.user_id, b.code AS bill_code
       FROM payments p JOIN dining.bill_payments b ON b.id = p.bill_payment_id
      WHERE p.provider_order_id = $1`,
    [input.orderId],
  );
  if (!payment || payment.user_id !== userId || payment.bill_code !== code) throw new NotFoundError('Payment order');

  if (payment.status !== 'success') {
    const valid = gateway.verifyPaymentSignature(input);
    if (!valid) {
      await query(
        `UPDATE payments SET status = 'failed', error_code = 'SIGNATURE_MISMATCH' WHERE id = $1 AND status <> 'success'`,
        [payment.id],
      );
      throw new PaymentError('Payment could not be verified', 'SIGNATURE_MISMATCH');
    }
    const remote = await gateway.fetchPayment(input.paymentId);
    const method = gateway.normaliseMethod(remote?.method);
    await query(
      `UPDATE payments SET status = 'success', provider_payment_id = $2, provider_signature = $3,
              method = $4::payment_method, captured_at = now(), raw_response = $5::jsonb
        WHERE id = $1 AND status <> 'success'`,
      [payment.id, input.paymentId, input.signature, method, JSON.stringify(remote ?? {})],
    );
    await markBillPaid(payment.bill_payment_id, { method, paymentId: input.paymentId, instrument: remote });
  }
  return getBillForUser(code, userId);
}

/**
 * Was a bank offer paid for with that bank's instrument? The diner is never
 * charged more after the fact; a mismatch is flagged for operations to settle
 * with the bank. Mock payments carry no instrument and always match.
 */
export function bankInstrumentMatches(
  remote: Record<string, unknown> | null | undefined,
  offer: { bankName: string | null; paymentMethods: string[] },
): boolean {
  if (!remote || remote.method === 'mock' || !offer.bankName) return true;
  const method = gateway.normaliseMethod(remote.method);
  if (offer.paymentMethods.length && !offer.paymentMethods.includes(method)) return false;
  const card = (remote.card ?? {}) as { issuer?: string };
  const issuer = String(card.issuer ?? remote.bank ?? remote.vpa ?? '').toUpperCase();
  return issuer.includes(offer.bankName.toUpperCase().split(/\s+/)[0]!);
}

/**
 * Settle a captured bill: status, offer redemptions, wallet capture, deposit
 * credit, cashback and the ledger posting commit together or not at all.
 * Idempotent — the guarded UPDATE means the client callback and the webhook
 * cannot both post.
 */
export interface SettleContext {
  method: string;
  paymentId: string;
  instrument?: Record<string, unknown> | null;
}

export async function markBillPaid(billId: string, context: SettleContext, options: { notify?: boolean } = {}): Promise<boolean> {
  const paid = await withTransaction((client) => settleBill(client, billId, context, options));
  if (paid) kickOutbox();
  return paid;
}

/**
 * The settlement itself, inside the caller's transaction — so the last share
 * of a split bill and the bill's own posting commit together.
 */
export async function settleBill(
  client: Queryable,
  billId: string,
  context: SettleContext,
  options: { notify?: boolean } = {},
): Promise<boolean> {
  const { rows } = await client.query<{
    id: string;
    code: string;
    user_id: string;
    restaurant_id: string;
    restaurant_name: string;
    reservation_id: string | null;
    pricing: BillPricing;
    bank_offer_id: string | null;
    split_count: number;
  }>(
    `UPDATE dining.bill_payments b SET status = 'paid', paid_at = now()
       FROM dining.restaurants r
      WHERE b.id = $1 AND b.status = 'pending_payment' AND r.id = b.restaurant_id
      RETURNING b.id, b.code, b.user_id, b.restaurant_id, r.name AS restaurant_name, b.reservation_id, b.pricing,
                b.bank_offer_id, b.split_count`,
    [billId],
  );
  const bill = rows[0];
  if (!bill) return false;
  const p = bill.pricing;
  const walletUsed = p.walletUsedPaise ?? 0;
  const coverCredit = p.coverCreditPaise ?? 0;
  const bankFunded = p.bankFundedDiscountPaise ?? 0;

  for (const applied of [p.restaurantOffer, p.coupon, p.bankOffer]) {
    if (!applied) continue;
    await client.query(
      `INSERT INTO dining.offer_redemptions (offer_id, user_id, bill_payment_id, discount_paise)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [applied.id, bill.user_id, bill.id, applied.discountPaise],
    );
  }

  // The restaurant is owed the bill less what it chose to give away, plus
  // service charge and tip. The diner's payment, the platform's promo spend,
  // the bank's share, the table deposit and the wallet together cover it.
  const owedGross = p.billTotalPaise - p.restaurantFundedDiscountPaise + p.serviceChargePaise + p.tipPaise;
  const feeNet = p.convenienceFeePaise - p.convenienceFeeGstPaise;
  const payable = restaurantPayable(bill.restaurant_id, bill.restaurant_name);
  await post(client, {
    kind: 'bill_paid',
    sourceType: 'dining.bill_payment',
    sourceId: bill.id,
    idempotencyKey: `bill_paid:${bill.id}`,
    memo: `${bill.code} via ${context.method} (${context.paymentId})`,
    entries: [
      // A split bill's shares were collected into the split account as they landed.
      { account: bill.split_count > 1 ? PLATFORM.splitCollections : PLATFORM.gatewayClearing, amountPaise: p.amountPayablePaise },
      { account: PLATFORM.promoExpense, amountPaise: p.platformFundedDiscountPaise },
      ...(bankFunded && p.bankOffer?.bankName ? [{ account: bankReceivable(p.bankOffer.bankName), amountPaise: bankFunded }] : []),
      { account: PLATFORM.coverDeposits, amountPaise: coverCredit },
      { account: PLATFORM.walletLiability, amountPaise: walletUsed },
      { account: payable, amountPaise: -owedGross },
      { account: PLATFORM.feeRevenue, amountPaise: -feeNet },
      { account: PLATFORM.gstOutput, amountPaise: -p.convenienceFeeGstPaise },
      { account: payable, amountPaise: p.commissionPaise + p.commissionGstPaise },
      { account: PLATFORM.commissionRevenue, amountPaise: -p.commissionPaise },
      { account: PLATFORM.gstOutput, amountPaise: -p.commissionGstPaise },
    ],
  });

  await captureForBill(client, bill.id);

  if (bill.reservation_id) {
    const { rows: reservationRows } = await client.query<{ cover_paise: number; cover_status: string }>(
      `UPDATE dining.reservations SET status = 'completed', completed_at = now(),
              cover_status = CASE WHEN cover_status = 'paid' THEN 'credited'::dining.cover_status ELSE cover_status END
        WHERE id = $1 AND status IN ('placed', 'confirmed', 'seated')
        RETURNING cover_paise, cover_status`,
      [bill.reservation_id],
    );
    // A deposit larger than the bill: the unused part goes to the restaurant.
    const leftover = reservationRows[0] && reservationRows[0].cover_status === 'credited'
      ? Number(reservationRows[0].cover_paise) - coverCredit
      : 0;
    if (leftover > 0) {
      await post(client, {
        kind: 'cover_unused',
        sourceType: 'dining.reservation',
        sourceId: bill.reservation_id,
        idempotencyKey: `cover_unused:${bill.reservation_id}`,
        memo: `Unused table deposit on ${bill.code}`,
        entries: [
          { account: PLATFORM.coverDeposits, amountPaise: leftover },
          { account: payable, amountPaise: -leftover },
        ],
      });
    }
  }

  // Bank offer paid with someone else's card: flag for operations, never re-charge.
  if (p.bankOffer && context.instrument !== undefined) {
    const offer = await client.query<{ bank_name: string | null; payment_methods: string[] }>(
      'SELECT bank_name, payment_methods FROM dining.offers WHERE id = $1',
      [bill.bank_offer_id],
    );
    const row = offer.rows[0];
    if (row && !bankInstrumentMatches(context.instrument, { bankName: row.bank_name, paymentMethods: row.payment_methods })) {
      await client.query(
        `UPDATE dining.bill_payments SET dispute_reason = 'Bank offer paid with an ineligible instrument' WHERE id = $1`,
        [bill.id],
      );
      logger.warn({ bill: bill.code }, 'Bank offer used with an ineligible instrument');
    }
  }

  // Cashback on what the diner actually paid for the meal — on a split bill,
  // to each payer in proportion to their share.
  const eligible = p.amountPayablePaise - p.convenienceFeePaise - p.tipPaise - p.serviceChargePaise;
  if (bill.split_count > 1) {
    const shares = await client.query<{ id: string; amount_paise: number; payer_user_id: string }>(
      `SELECT id, amount_paise, payer_user_id FROM dining.bill_shares WHERE bill_payment_id = $1 AND status = 'paid'`,
      [bill.id],
    );
    for (const share of shares.rows) {
      await accrueCashback(client, {
        userId: share.payer_user_id,
        billId: bill.id,
        shareId: share.id,
        eligiblePaise: Math.floor((eligible * Number(share.amount_paise)) / p.amountPayablePaise),
      });
    }
  } else {
    await accrueCashback(client, { userId: bill.user_id, billId: bill.id, eligiblePaise: eligible });
  }

  await enqueue(client, TOPICS.billPaid, { billId: bill.id, notify: options.notify !== false });
  logger.info({ bill: bill.code, payable: p.amountPayablePaise }, 'Dine-in bill paid');
  return true;
}

registerPaymentSubject('bill_payment', {
  async captured(subjectId, context) {
    await markBillPaid(subjectId, context);
  },
});

/* ───────────────────────── read ───────────────────────── */

interface BillRow {
  id: string;
  code: string;
  status: string;
  user_id: string;
  restaurant_id: string;
  restaurant_slug: string;
  restaurant_name: string;
  restaurant_locality: string;
  restaurant_cover: string | null;
  restaurant_logo: string | null;
  reservation_code: string | null;
  pricing: BillPricing;
  amount_payable_paise: number;
  verify_secret: string;
  verified_at: Date | null;
  verification_method: string | null;
  dispute_reason: string | null;
  paid_at: Date | null;
  created_at: Date;
  diner_name?: string;
  diner_phone?: string | null;
  has_review?: boolean;
  split_count: number;
}

const BILL_SELECT = `
  SELECT b.id, b.code, b.status, b.user_id, b.restaurant_id, r.slug AS restaurant_slug, r.name AS restaurant_name,
         r.locality AS restaurant_locality, r.cover_url AS restaurant_cover, r.logo_url AS restaurant_logo,
         v.code AS reservation_code, b.pricing, b.amount_payable_paise, b.verify_secret, b.verified_at,
         b.verification_method, b.dispute_reason, b.paid_at, b.created_at, b.split_count,
         u.full_name AS diner_name, u.phone AS diner_phone,
         EXISTS (SELECT 1 FROM dining.reviews rv WHERE rv.bill_payment_id = b.id) AS has_review
    FROM dining.bill_payments b
    JOIN dining.restaurants r ON r.id = b.restaurant_id
    JOIN users u ON u.id = b.user_id
    LEFT JOIN dining.reservations v ON v.id = b.reservation_id`;

/** The live pass is only meaningful while staff might still need to see it. */
function passFor(row: BillRow) {
  if (row.status !== 'paid') return null;
  const { code, stepEndsAt } = codeAt(row.verify_secret);
  return { code, stepEndsAt, stepSeconds: STEP_SECONDS, serverNow: new Date() };
}

function toBill(row: BillRow) {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    restaurant: {
      id: row.restaurant_id,
      slug: row.restaurant_slug,
      name: row.restaurant_name,
      locality: row.restaurant_locality,
      coverUrl: row.restaurant_cover,
      logoUrl: row.restaurant_logo,
    },
    reservationCode: row.reservation_code,
    pricing: publicPricing(row.pricing),
    amountPaidPaise: Number(row.amount_payable_paise),
    pass: passFor(row),
    verifiedAt: row.verified_at,
    verificationMethod: row.verification_method,
    disputeReason: row.dispute_reason,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    canReview: (row.status === 'verified' || row.status === 'paid') && !row.has_review,
    /** People sharing the payment; details come from the split endpoint. */
    splitCount: row.split_count,
  };
}
export type BillView = ReturnType<typeof toBill>;

export async function getBillForUser(code: string, userId: string): Promise<BillView> {
  const row = await queryOne<BillRow>(`${BILL_SELECT} WHERE b.code = $1 AND b.user_id = $2`, [code, userId]);
  if (!row) throw new NotFoundError('Bill');
  return toBill(row);
}

export async function listBillsForUser(userId: string): Promise<BillView[]> {
  const { rows } = await query<BillRow>(
    `${BILL_SELECT} WHERE b.user_id = $1 AND b.status <> 'pending_payment' ORDER BY b.created_at DESC LIMIT 100`,
    [userId],
  );
  return rows.map(toBill);
}

/* ───────────────────────── partner side ───────────────────────── */

/**
 * What staff see on the Live screen. The current pass code is included so the
 * cashier compares the diner's phone with their own screen — a stale
 * screenshot shows a different code.
 */
function toPartnerBill(row: BillRow) {
  const pass = passFor(row);
  const phone = row.diner_phone ?? '';
  return {
    code: row.code,
    status: row.status,
    billTotalPaise: row.pricing.billTotalPaise,
    amountPaidPaise: Number(row.amount_payable_paise),
    totalDiscountPaise: row.pricing.totalDiscountPaise,
    restaurantPayoutPaise: row.pricing.restaurantPayoutPaise,
    dinerName: (row.diner_name ?? '').split(' ')[0] ?? '',
    phoneLast4: phone.slice(-4) || null,
    reservationCode: row.reservation_code,
    passCode: pass?.code ?? null,
    stepEndsAt: pass?.stepEndsAt ?? null,
    paidAt: row.paid_at,
    verifiedAt: row.verified_at,
    verificationMethod: row.verification_method,
    disputeReason: row.dispute_reason,
  };
}
export type PartnerBill = ReturnType<typeof toPartnerBill>;

export async function listBillsForRestaurant(restaurantId: string, date: string): Promise<PartnerBill[]> {
  const { rows } = await query<BillRow>(
    `${BILL_SELECT}
      WHERE b.restaurant_id = $1 AND b.status IN ('paid', 'verified', 'disputed', 'refunded')
        AND (b.paid_at AT TIME ZONE '${DINING_TZ}')::date = $2::date
      ORDER BY (b.status = 'paid') DESC, b.paid_at DESC`,
    [restaurantId, date],
  );
  return rows.map(toPartnerBill);
}

export async function verifyAtTable(
  restaurantId: string,
  code: string,
  staffUserId: string,
  result: 'match' | 'mismatch',
  reason?: string | null,
): Promise<PartnerBill> {
  const next = result === 'match' ? 'verified' : 'disputed';
  const { rowCount } = await query(
    `UPDATE dining.bill_payments
        SET status = $3::dining.bill_status, verified_by = $4,
            verified_at = CASE WHEN $3 = 'verified' THEN now() END,
            verification_method = CASE WHEN $3 = 'verified' THEN 'staff' END,
            dispute_reason = CASE WHEN $3 = 'disputed' THEN $5 END
      WHERE code = $1 AND restaurant_id = $2 AND status = 'paid'`,
    [code, restaurantId, next, staffUserId, reason ?? null],
  );
  if (!rowCount) throw new ConflictError('This payment has already been checked', 'BILL_ALREADY_CHECKED');
  const row = await queryOne<BillRow>(`${BILL_SELECT} WHERE b.code = $1`, [code]);
  return toPartnerBill(row!);
}

/** Paid bills nobody disputed within the window count as verified. */
export async function autoVerifyStaleBills(): Promise<number> {
  const hours = Number(await getSetting('dining_auto_verify_hours'));
  const { rowCount } = await query(
    `UPDATE dining.bill_payments SET status = 'verified', verified_at = now(), verification_method = 'auto'
      WHERE status = 'paid' AND paid_at < now() - make_interval(hours => $1)`,
    [hours],
  );
  return rowCount ?? 0;
}

/** Abandoned checkouts: unpaid bills older than an hour are cancelled and their wallet holds returned. */
export async function cancelAbandonedBills(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE dining.bill_payments SET status = 'cancelled'
        WHERE id IN (SELECT id FROM dining.bill_payments
                      WHERE status = 'pending_payment' AND split_count = 1 AND created_at < now() - interval '1 hour'
                      LIMIT 500 FOR UPDATE SKIP LOCKED)
        RETURNING id`,
    );
    for (const row of rows) await releaseForBill(client, row.id);
    return rows.length;
  });
}
