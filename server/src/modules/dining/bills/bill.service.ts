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
import { getSetting } from '../../../services/settings.service';
import * as gateway from '../../../services/razorpay.provider';
import { registerPaymentSubject } from '../../payments/subjects';
import { PLATFORM, post, restaurantPayable } from '../../finance/ledger';
import { DINING_TZ, toLocalMoment } from '../time';
import { priceBill, type BillPricing, type OfferMode } from '../offers/engine';
import { activeRestaurantOffers, findCoupon, reviveEngineOffer, toEngineOffer, usageFor } from '../offers/offer.service';
import { codeAt, newVerifySecret, STEP_SECONDS } from './verification';

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
  })
  .refine((value) => value.nonDiscountable <= value.billTotal, {
    message: 'This cannot be more than the bill',
    path: ['nonDiscountable'],
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
 * bill and carries its promised offer.
 */
async function loadReservation(code: string | null | undefined, userId: string | null, restaurantId: string, client: Queryable) {
  if (!code || !userId) return null;
  const { rows } = await client.query<{ id: string; offer_snapshot: unknown }>(
    `SELECT id, offer_snapshot FROM dining.reservations
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
  mode: OfferMode;
  pricing: BillPricing;
}

async function price(input: BillInput, userId: string | null, client: Queryable): Promise<PricingContext> {
  const restaurant = await loadRestaurant(input.restaurantId, client);
  const reservation = await loadReservation(input.reservationCode, userId, restaurant.id, client);

  const offers = (await activeRestaurantOffers(restaurant.id, client)).map(toEngineOffer);
  const couponRow = input.couponCode ? await findCoupon(input.couponCode, restaurant.id, client) : null;
  const coupon = couponRow ? toEngineOffer(couponRow) : null;
  const promised = reservation ? reviveEngineOffer(reservation.offer_snapshot) : null;

  const offerIds = [...offers.map((offer) => offer.id), ...(coupon ? [coupon.id] : []), ...(promised ? [promised.id] : [])];
  const usage = await usageFor(userId, offerIds, client);
  const fee = Number(await getSetting('dining_convenience_fee_paise'));
  const mode: OfferMode = reservation ? 'prebook' : 'walkin';

  const pricing = priceBill({
    billTotalPaise: rupeesToPaise(input.billTotal),
    nonDiscountablePaise: rupeesToPaise(input.nonDiscountable),
    keepServiceCharge: input.keepServiceCharge,
    serviceChargePercent: Number(restaurant.service_charge_percent),
    tipPaise: rupeesToPaise(input.tip),
    mode,
    at: toLocalMoment(new Date()),
    restaurantOffers: offers,
    promisedOffer: promised,
    coupon,
    couponCodeNotFound: input.couponCode && !couponRow ? input.couponCode : null,
    usage,
    convenienceFeePaise: fee,
    commissionBps: restaurant.commission_bps,
  });

  return { restaurant, reservationId: reservation?.id ?? null, mode, pricing };
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
  const { pricing, mode } = await price(input, userId, { query });
  return { mode, ...publicPricing(pricing) };
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
export async function createBill(userId: string, input: BillInput, idempotencyKey: string | null): Promise<BillCheckout> {
  if (idempotencyKey) {
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM dining.bill_payments WHERE user_id = $1 AND idempotency_key = $2',
      [userId, idempotencyKey],
    );
    if (existing) return checkoutFor(existing.id);
  }

  const billId = await withTransaction(async (client) => {
    const { restaurant, reservationId, pricing } = await price(input, userId, client);
    if (input.couponCode && pricing.couponError) {
      throw new BadRequestError(pricing.couponError, 'COUPON_INVALID');
    }
    if (pricing.amountPayablePaise <= 0) throw new BadRequestError('Nothing to pay on this bill', 'NOTHING_TO_PAY');

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO dining.bill_payments (
         code, user_id, restaurant_id, reservation_id, status, idempotency_key, bill_total_paise,
         non_discountable_paise, service_charge_paise, tip_paise, pricing, restaurant_discount_paise,
         platform_discount_paise, convenience_fee_paise, amount_payable_paise, commission_base_paise,
         commission_paise, commission_gst_paise, restaurant_payout_paise, verify_secret)
       VALUES ($1, $2, $3, $4, 'pending_payment', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
      ],
    );
    if (rows[0]) return rows[0].id;
    // A concurrent request with the same key won the insert.
    const { rows: raced } = await client.query<{ id: string }>(
      'SELECT id FROM dining.bill_payments WHERE user_id = $1 AND idempotency_key = $2',
      [userId, idempotencyKey],
    );
    return raced[0]!.id;
  });

  return checkoutFor(billId);
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
    await markBillPaid(payment.bill_payment_id, { method, paymentId: input.paymentId });
  }
  return getBillForUser(code, userId);
}

/**
 * Settle a captured bill: status, offer redemptions and the ledger posting
 * commit together or not at all. Idempotent — the guarded UPDATE means the
 * client callback and the webhook cannot both post.
 */
export async function markBillPaid(billId: string, context: { method: string; paymentId: string }): Promise<boolean> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      code: string;
      user_id: string;
      restaurant_id: string;
      restaurant_name: string;
      reservation_id: string | null;
      pricing: BillPricing;
    }>(
      `UPDATE dining.bill_payments b SET status = 'paid', paid_at = now()
         FROM dining.restaurants r
        WHERE b.id = $1 AND b.status = 'pending_payment' AND r.id = b.restaurant_id
        RETURNING b.id, b.code, b.user_id, b.restaurant_id, r.name AS restaurant_name, b.reservation_id, b.pricing`,
      [billId],
    );
    const bill = rows[0];
    if (!bill) return false;
    const p = bill.pricing;

    for (const applied of [p.restaurantOffer, p.coupon]) {
      if (!applied) continue;
      await client.query(
        `INSERT INTO dining.offer_redemptions (offer_id, user_id, bill_payment_id, discount_paise)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [applied.id, bill.user_id, bill.id, applied.discountPaise],
      );
    }

    // The restaurant is owed the bill less what it chose to give away, plus
    // service charge and tip; the platform's promo spend tops that up.
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
        { account: PLATFORM.gatewayClearing, amountPaise: p.amountPayablePaise },
        { account: PLATFORM.promoExpense, amountPaise: p.platformFundedDiscountPaise },
        { account: payable, amountPaise: -owedGross },
        { account: PLATFORM.feeRevenue, amountPaise: -feeNet },
        { account: PLATFORM.gstOutput, amountPaise: -p.convenienceFeeGstPaise },
        { account: payable, amountPaise: p.commissionPaise + p.commissionGstPaise },
        { account: PLATFORM.commissionRevenue, amountPaise: -p.commissionPaise },
        { account: PLATFORM.gstOutput, amountPaise: -p.commissionGstPaise },
      ],
    });

    if (bill.reservation_id) {
      await client.query(
        `UPDATE dining.reservations SET status = 'completed', completed_at = now()
          WHERE id = $1 AND status IN ('placed', 'confirmed', 'seated')`,
        [bill.reservation_id],
      );
    }
    logger.info({ bill: bill.code, payable: p.amountPayablePaise }, 'Dine-in bill paid');
    return true;
  });
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
}

const BILL_SELECT = `
  SELECT b.id, b.code, b.status, b.user_id, b.restaurant_id, r.slug AS restaurant_slug, r.name AS restaurant_name,
         r.locality AS restaurant_locality, r.cover_url AS restaurant_cover, r.logo_url AS restaurant_logo,
         v.code AS reservation_code, b.pricing, b.amount_payable_paise, b.verify_secret, b.verified_at,
         b.verification_method, b.dispute_reason, b.paid_at, b.created_at,
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

/** Abandoned checkouts: unpaid bills older than an hour are cancelled. */
export async function cancelAbandonedBills(): Promise<number> {
  const { rowCount } = await query(
    `UPDATE dining.bill_payments SET status = 'cancelled'
      WHERE status = 'pending_payment' AND created_at < now() - interval '1 hour'`,
  );
  return rowCount ?? 0;
}
