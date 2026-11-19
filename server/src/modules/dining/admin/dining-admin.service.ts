import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../../utils/errors';
import { readableCode, uniqueSlug } from '../../../utils/ids';
import { OFFER_COLUMNS, toPublicOffer, type OfferRow } from '../offers/offer.service';
import { rupeesToPaise } from '../../../utils/money';
import { liabilityBalance, PLATFORM, post, restaurantPayable } from '../../finance/ledger';
import { env } from '../../../config/env';
import { GSTIN_PATTERN } from '../../../utils/gst';
import * as gateway from '../../../services/razorpay.provider';

/* ─────────────────────── onboarding ─────────────────────── */

/** Upper-cased and checked; an empty field clears it. */
const gstinField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => value || null)
  .refine((value) => value === null || GSTIN_PATTERN.test(value), 'A GSTIN has 15 characters, like 08ABCDE1234F1Z5')
  .nullish();

export const restaurantInput = z.object({
  name: z.string().trim().min(2).max(120),
  citySlug: z.string().trim().min(2),
  locality: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(300),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  phone: z.string().trim().max(20).nullish(),
  description: z.string().trim().max(2000).nullish(),
  costForTwo: z.coerce.number().min(0).max(100_000),
  cuisines: z.array(z.string().trim().min(2).max(40)).min(1).max(8),
  tags: z.array(z.string().trim().min(2).max(40)).max(12).default([]),
  coverUrl: z.string().url().nullish(),
  commissionPercent: z.coerce.number().min(0).max(30).default(6),
  serviceChargePercent: z.coerce.number().min(0).max(20).default(0),
  gstin: gstinField,
  fssai: z.string().trim().max(20).nullish(),
  ownerEmail: z.string().email().nullish(),
});
export type RestaurantInput = z.infer<typeof restaurantInput>;

const DEFAULT_HOURS = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((day) => [String(day), [['12:00', '15:30'], ['19:00', '23:30']]]),
);

export async function listAllRestaurants() {
  const { rows } = await query<{
    id: string;
    slug: string;
    name: string;
    locality: string;
    status: string;
    commission_bps: number;
    city: string;
    members: number;
  }>(
    `SELECT r.id, r.slug, r.name, r.locality, r.status, r.commission_bps, c.name AS city,
            (SELECT count(*)::int FROM dining.restaurant_members m WHERE m.restaurant_id = r.id) AS members
       FROM dining.restaurants r JOIN cities c ON c.id = r.city_id
      ORDER BY r.created_at DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    locality: row.locality,
    city: row.city,
    status: row.status,
    commissionPercent: row.commission_bps / 100,
    members: row.members,
  }));
}

export async function createRestaurant(input: RestaurantInput, adminId: string) {
  const city = await queryOne<{ id: string }>('SELECT id FROM cities WHERE slug = $1', [input.citySlug]);
  if (!city) throw new BadRequestError('Unknown city', 'UNKNOWN_CITY');

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; slug: string }>(
      `INSERT INTO dining.restaurants (slug, name, description, city_id, locality, address, lat, lng, phone,
                                       cost_for_two_paise, cuisines, tags, hours, cover_url, status,
                                       commission_bps, service_charge_percent, gstin, fssai)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending_review', $15, $16, $17, $18)
       RETURNING id, slug`,
      [
        uniqueSlug(`${input.name} ${input.locality}`),
        input.name,
        input.description ?? null,
        city.id,
        input.locality,
        input.address,
        input.lat,
        input.lng,
        input.phone ?? null,
        rupeesToPaise(input.costForTwo),
        input.cuisines,
        input.tags,
        JSON.stringify(DEFAULT_HOURS),
        input.coverUrl ?? null,
        Math.round(input.commissionPercent * 100),
        input.serviceChargePercent,
        input.gstin ?? null,
        input.fssai ?? null,
      ],
    );
    const restaurant = rows[0]!;

    // Sensible default availability so a new outlet is bookable on go-live.
    for (let weekday = 0; weekday < 7; weekday += 1) {
      await client.query(
        `INSERT INTO dining.inventory_rules (restaurant_id, weekday, start_time, end_time, slot_minutes, covers_per_slot)
         VALUES ($1, $2, '12:30', '15:00', 30, 16), ($1, $2, '19:00', '22:30', 30, 24)`,
        [restaurant.id, weekday],
      );
    }

    if (input.ownerEmail) {
      const owner = await client.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [input.ownerEmail]);
      if (!owner.rows[0]) throw new BadRequestError('No Tixit account uses that owner email yet', 'OWNER_NOT_FOUND');
      await client.query(
        `INSERT INTO dining.restaurant_members (restaurant_id, user_id, role, invited_by) VALUES ($1, $2, 'owner', $3)`,
        [restaurant.id, owner.rows[0].id, adminId],
      );
    }
    return restaurant;
  });
}

export async function setRestaurantStatus(id: string, status: 'live' | 'paused' | 'delisted' | 'pending_review') {
  const { rowCount } = await query('UPDATE dining.restaurants SET status = $2 WHERE id = $1', [id, status]);
  if (!rowCount) throw new NotFoundError('Restaurant');
}

/** Give an existing Tixit account a role at a restaurant (the same login works everywhere). */
export async function addMember(restaurantId: string, email: string, role: 'owner' | 'manager' | 'host' | 'cashier', invitedBy: string) {
  const user = await queryOne<{ id: string; full_name: string }>('SELECT id, full_name FROM users WHERE lower(email) = lower($1)', [email]);
  if (!user) throw new BadRequestError('No Tixit account uses that email yet — ask them to sign up first', 'USER_NOT_FOUND');
  await query(
    `INSERT INTO dining.restaurant_members (restaurant_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (restaurant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [restaurantId, user.id, role, invitedBy],
  );
  return { userId: user.id, fullName: user.full_name, role };
}

/* ─────────────────────── settlements ─────────────────────── */

export const settlementInput = z.object({
  amount: z.coerce.number().min(1),
  /** Required for manual transfers; Route transfers carry their own id. */
  utr: z.string().trim().max(60).nullish(),
});

/**
 * Pay a restaurant what it is owed. It can never exceed the ledger balance,
 * and it is posted, not just noted, so the balance moves.
 *
 * With Razorpay Route enabled and a linked account on the restaurant, the
 * money is sent as a Route transfer; otherwise the payout is recorded against
 * a bank UTR from a manual transfer.
 */
export async function recordSettlement(restaurantId: string, input: z.infer<typeof settlementInput>, adminId: string) {
  const amountPaise = rupeesToPaise(input.amount);
  return withTransaction(async (client) => {
    // Serialise settlements per restaurant so two admins cannot double-pay.
    const { rows: locked } = await client.query<{ razorpay_account_id: string | null; name: string }>(
      'SELECT razorpay_account_id, name FROM dining.restaurants WHERE id = $1 FOR UPDATE',
      [restaurantId],
    );
    if (!locked[0]) throw new NotFoundError('Restaurant');
    const payable = restaurantPayable(restaurantId);
    const balance = await liabilityBalance(payable.code, client);
    if (amountPaise > balance) {
      throw new ConflictError(`Only ₹${(balance / 100).toLocaleString('en-IN')} is owed to this restaurant`, 'EXCEEDS_BALANCE');
    }

    const reference = `STL-${readableCode(6)}`;
    const viaRoute = env.razorpay.routeEnabled && Boolean(locked[0].razorpay_account_id);
    if (!viaRoute && !input.utr) {
      throw new BadRequestError('Enter the bank UTR for this manual transfer', 'UTR_REQUIRED');
    }
    // The transfer runs inside the lock so a retry can never send twice; if
    // it fails, the transaction rolls back and nothing is recorded.
    const transfer = viaRoute
      ? await gateway.createTransfer({
          account: locked[0].razorpay_account_id!,
          amountPaise,
          notes: { reference, restaurant: locked[0].name },
        })
      : null;

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO finance.settlements (reference, restaurant_id, amount_paise, utr, status, created_by, method, razorpay_transfer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        reference,
        restaurantId,
        amountPaise,
        input.utr ?? null,
        transfer && transfer.status !== 'processed' ? 'processing' : 'paid',
        adminId,
        viaRoute ? 'route' : 'manual',
        transfer?.id ?? null,
      ],
    );
    const settlementId = rows[0]!.id;
    const transactionId = await post(client, {
      kind: 'settlement',
      sourceType: 'finance.settlement',
      sourceId: settlementId,
      idempotencyKey: `settlement:${settlementId}`,
      memo: `${reference}${transfer ? ` · Route ${transfer.id}` : input.utr ? ` · UTR ${input.utr}` : ''}`,
      entries: [
        { account: payable, amountPaise },
        { account: PLATFORM.gatewayClearing, amountPaise: -amountPaise },
      ],
    });
    await client.query('UPDATE finance.settlements SET transaction_id = $2 WHERE id = $1', [settlementId, transactionId]);
    return { reference, amountPaise, method: viaRoute ? 'route' : 'manual', transferId: transfer?.id ?? null };
  });
}

/**
 * Route webhooks: a processed transfer settles; a failed one is reversed so
 * the restaurant is owed the money again.
 */
export async function onTransferEvent(transferId: string, outcome: 'processed' | 'failed', reason?: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; restaurant_id: string; amount_paise: number; status: string }>(
      `SELECT id, restaurant_id, amount_paise, status FROM finance.settlements WHERE razorpay_transfer_id = $1 FOR UPDATE`,
      [transferId],
    );
    const settlement = rows[0];
    if (!settlement || settlement.status === 'failed') return;
    if (outcome === 'processed') {
      await client.query(`UPDATE finance.settlements SET status = 'paid' WHERE id = $1`, [settlement.id]);
      return;
    }
    await client.query(`UPDATE finance.settlements SET status = 'failed', failure_reason = $2 WHERE id = $1`, [settlement.id, reason ?? null]);
    await post(client, {
      kind: 'settlement_reversed',
      sourceType: 'finance.settlement',
      sourceId: settlement.id,
      idempotencyKey: `settlement_reversed:${settlement.id}`,
      memo: reason ?? 'Route transfer failed',
      entries: [
        { account: PLATFORM.gatewayClearing, amountPaise: Number(settlement.amount_paise) },
        { account: restaurantPayable(settlement.restaurant_id), amountPaise: -Number(settlement.amount_paise) },
      ],
    });
  });
}

/* ─────────────────────── detail & commercials ─────────────────────── */

export async function getRestaurantForAdmin(id: string) {
  const row = await queryOne<{
    id: string;
    slug: string;
    name: string;
    locality: string;
    address: string;
    status: string;
    commission_bps: number;
    service_charge_percent: string | number;
    gstin: string | null;
    fssai: string | null;
    cover_url: string | null;
    city: string;
    created_at: Date;
    razorpay_account_id: string | null;
    legal_name: string | null;
    billing_address: string | null;
  }>(
    `SELECT r.id, r.slug, r.name, r.locality, r.address, r.status, r.commission_bps, r.service_charge_percent,
            r.gstin, r.fssai, r.cover_url, c.name AS city, r.created_at, r.razorpay_account_id, r.legal_name, r.billing_address
       FROM dining.restaurants r JOIN cities c ON c.id = r.city_id WHERE r.id = $1`,
    [id],
  );
  if (!row) throw new NotFoundError('Restaurant');

  const [{ rows: members }, balance, stats] = await Promise.all([
    query<{ user_id: string; full_name: string; email: string; role: string }>(
      `SELECT m.user_id, u.full_name, u.email, m.role
         FROM dining.restaurant_members m JOIN users u ON u.id = m.user_id
        WHERE m.restaurant_id = $1
        ORDER BY array_position(ARRAY['owner','manager','host','cashier']::text[], m.role::text), u.full_name`,
      [id],
    ),
    liabilityBalance(restaurantPayable(id).code),
    queryOne<{ bills: number; gross: number; commission: number }>(
      `SELECT count(*)::int AS bills,
              COALESCE(sum((pricing->>'billTotalPaise')::bigint), 0)::bigint AS gross,
              COALESCE(sum(commission_paise), 0)::bigint AS commission
         FROM dining.bill_payments WHERE restaurant_id = $1 AND status IN ('paid', 'verified', 'disputed')`,
      [id],
    ),
  ]);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    locality: row.locality,
    address: row.address,
    city: row.city,
    status: row.status,
    coverUrl: row.cover_url,
    commissionPercent: row.commission_bps / 100,
    serviceChargePercent: Number(row.service_charge_percent),
    gstin: row.gstin,
    fssai: row.fssai,
    legalName: row.legal_name,
    billingAddress: row.billing_address,
    razorpayAccountId: row.razorpay_account_id,
    /** Payouts go out as Route transfers when this is true. */
    routePayouts: env.razorpay.routeEnabled && Boolean(row.razorpay_account_id),
    createdAt: row.created_at,
    payableBalancePaise: balance,
    lifetime: {
      bills: Number(stats?.bills ?? 0),
      grossPaise: Number(stats?.gross ?? 0),
      commissionPaise: Number(stats?.commission ?? 0),
    },
    members: members.map((m) => ({ userId: m.user_id, fullName: m.full_name, email: m.email, role: m.role })),
  };
}

export const commercialsInput = z.object({
  commissionPercent: z.coerce.number().min(0).max(30).optional(),
  serviceChargePercent: z.coerce.number().min(0).max(20).optional(),
  gstin: gstinField,
  legalName: z.string().trim().max(160).nullish(),
  billingAddress: z.string().trim().max(400).nullish(),
  fssai: z.string().trim().max(20).nullish(),
  razorpayAccountId: z.string().trim().regex(/^acc_[A-Za-z0-9]{6,}$/, 'Linked account ids look like acc_XXXXXXXX').nullish(),
});

/**
 * Commission applies to bills created after the change: every bill freezes
 * its own commission when it is priced, so history never moves.
 */
export async function updateCommercials(id: string, input: z.infer<typeof commercialsInput>) {
  const { rowCount } = await query(
    `UPDATE dining.restaurants SET
       commission_bps = COALESCE($2, commission_bps),
       service_charge_percent = COALESCE($3, service_charge_percent),
       gstin = CASE WHEN $4::boolean THEN $5 ELSE gstin END,
       fssai = CASE WHEN $6::boolean THEN $7 ELSE fssai END,
       razorpay_account_id = CASE WHEN $8::boolean THEN $9 ELSE razorpay_account_id END,
       legal_name = CASE WHEN $10::boolean THEN $11 ELSE legal_name END,
       billing_address = CASE WHEN $12::boolean THEN $13 ELSE billing_address END
     WHERE id = $1`,
    [
      id,
      input.commissionPercent === undefined ? null : Math.round(input.commissionPercent * 100),
      input.serviceChargePercent ?? null,
      input.gstin !== undefined,
      input.gstin ?? null,
      input.fssai !== undefined,
      input.fssai ?? null,
      input.razorpayAccountId !== undefined,
      input.razorpayAccountId ?? null,
      input.legalName !== undefined,
      input.legalName || null,
      input.billingAddress !== undefined,
      input.billingAddress || null,
    ],
  );
  if (!rowCount) throw new NotFoundError('Restaurant');
  return getRestaurantForAdmin(id);
}

export async function removeMember(restaurantId: string, userId: string) {
  const owners = await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM dining.restaurant_members WHERE restaurant_id = $1 AND role = 'owner'`,
    [restaurantId],
  );
  const target = await queryOne<{ role: string }>(
    'SELECT role FROM dining.restaurant_members WHERE restaurant_id = $1 AND user_id = $2',
    [restaurantId, userId],
  );
  if (!target) throw new NotFoundError('Staff member');
  if (target.role === 'owner' && Number(owners?.count) <= 1) {
    throw new ConflictError('A restaurant must keep at least one owner', 'LAST_OWNER');
  }
  await query('DELETE FROM dining.restaurant_members WHERE restaurant_id = $1 AND user_id = $2', [restaurantId, userId]);
}

/* ─────────────────────── platform & bank offers ─────────────────────── */

export const platformOfferInput = z
  .object({
    owner: z.enum(['platform', 'bank']),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,20}$/, 'Codes are 3–20 letters or digits').nullish(),
    bankName: z.string().trim().min(2).max(40).nullish(),
    paymentMethods: z.array(z.enum(['credit_card', 'debit_card', 'upi', 'netbanking'])).default([]),
    title: z.string().trim().min(3).max(80),
    kind: z.enum(['percent', 'flat']),
    percentOff: z.coerce.number().min(1).max(100).nullish(),
    flatOff: z.coerce.number().min(1).max(100_000).nullish(),
    maxDiscount: z.coerce.number().min(1).max(100_000).nullish(),
    minBill: z.coerce.number().min(0).max(1_000_000).default(0),
    perUserLimit: z.coerce.number().int().min(1).max(100).nullish(),
    restaurantFundedPct: z.coerce.number().int().min(0).max(100).default(0),
    validUntil: z.string().datetime({ offset: true }).nullish(),
    terms: z.string().trim().max(500).nullish(),
  })
  .refine((v) => (v.kind === 'percent' ? Boolean(v.percentOff) : Boolean(v.flatOff)), { message: 'Enter how much it takes off', path: ['percentOff'] })
  .refine((v) => v.owner !== 'platform' || Boolean(v.code), { message: 'A Tixit offer needs a code', path: ['code'] })
  .refine((v) => v.owner !== 'bank' || Boolean(v.bankName), { message: 'Name the bank funding the offer', path: ['bankName'] });

export async function listPlatformOffers() {
  const { rows } = await query<OfferRow & { redemptions: number; discount: number }>(
    `SELECT ${OFFER_COLUMNS},
            (SELECT count(*)::int FROM dining.offer_redemptions x WHERE x.offer_id = o.id) AS redemptions,
            (SELECT COALESCE(sum(discount_paise), 0)::bigint FROM dining.offer_redemptions x WHERE x.offer_id = o.id) AS discount
       FROM dining.offers o WHERE o.owner IN ('platform', 'bank') AND o.status <> 'archived'
      ORDER BY o.owner, o.created_at DESC`,
  );
  return rows.map((row) => ({ ...toPublicOffer(row), redemptions: row.redemptions, discountGivenPaise: Number(row.discount) }));
}

export async function createPlatformOffer(input: z.infer<typeof platformOfferInput>, adminId: string) {
  const row = await queryOne<OfferRow>(
    `INSERT INTO dining.offers AS o (owner, code, bank_name, payment_methods, title, kind, percent_off, flat_off_paise,
       max_discount_paise, min_bill_paise, per_user_limit, restaurant_funded_pct, valid_until, terms, applies_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'both', $15)
     RETURNING ${OFFER_COLUMNS}`,
    [
      input.owner,
      input.code ?? null,
      input.owner === 'bank' ? input.bankName : null,
      input.paymentMethods,
      input.title,
      input.kind,
      input.kind === 'percent' ? input.percentOff : null,
      input.kind === 'flat' ? rupeesToPaise(input.flatOff!) : null,
      input.maxDiscount ? rupeesToPaise(input.maxDiscount) : null,
      rupeesToPaise(input.minBill),
      input.perUserLimit ?? null,
      input.restaurantFundedPct,
      input.validUntil ?? null,
      input.terms ?? null,
      adminId,
    ],
  ).catch((err: { code?: string }) => {
    if (err.code === '23505') throw new ConflictError('That code is already in use', 'CODE_TAKEN');
    throw err;
  });
  return toPublicOffer(row!);
}

export async function setPlatformOfferStatus(id: string, status: 'active' | 'paused' | 'archived') {
  const { rowCount } = await query(`UPDATE dining.offers SET status = $2 WHERE id = $1 AND owner IN ('platform', 'bank')`, [id, status]);
  if (!rowCount) throw new NotFoundError('Offer');
}
