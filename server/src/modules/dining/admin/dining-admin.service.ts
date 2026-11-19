import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../../utils/errors';
import { readableCode, uniqueSlug } from '../../../utils/ids';
import { rupeesToPaise } from '../../../utils/money';
import { liabilityBalance, PLATFORM, post, restaurantPayable } from '../../finance/ledger';

/* ─────────────────────── onboarding ─────────────────────── */

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
  gstin: z.string().trim().max(20).nullish(),
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
  utr: z.string().trim().max(60).nullish(),
});

/**
 * Record a payout to a restaurant. It can never exceed what the ledger says
 * the platform owes, and it is posted, not just noted, so the balance moves.
 */
export async function recordSettlement(restaurantId: string, input: z.infer<typeof settlementInput>, adminId: string) {
  const amountPaise = rupeesToPaise(input.amount);
  return withTransaction(async (client) => {
    // Serialise settlements per restaurant so two admins cannot double-pay.
    await client.query('SELECT 1 FROM dining.restaurants WHERE id = $1 FOR UPDATE', [restaurantId]);
    const payable = restaurantPayable(restaurantId);
    const balance = await liabilityBalance(payable.code, client);
    if (amountPaise > balance) {
      throw new ConflictError(`Only ₹${(balance / 100).toLocaleString('en-IN')} is owed to this restaurant`, 'EXCEEDS_BALANCE');
    }

    const reference = `STL-${readableCode(6)}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO finance.settlements (reference, restaurant_id, amount_paise, utr, status, created_by)
       VALUES ($1, $2, $3, $4, 'paid', $5) RETURNING id`,
      [reference, restaurantId, amountPaise, input.utr ?? null, adminId],
    );
    const settlementId = rows[0]!.id;
    const transactionId = await post(client, {
      kind: 'settlement',
      sourceType: 'finance.settlement',
      sourceId: settlementId,
      idempotencyKey: `settlement:${settlementId}`,
      memo: `${reference}${input.utr ? ` · UTR ${input.utr}` : ''}`,
      entries: [
        { account: payable, amountPaise },
        { account: PLATFORM.gatewayClearing, amountPaise: -amountPaise },
      ],
    });
    await client.query('UPDATE finance.settlements SET transaction_id = $2 WHERE id = $1', [settlementId, transactionId]);
    return { reference, amountPaise };
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
  }>(
    `SELECT r.id, r.slug, r.name, r.locality, r.address, r.status, r.commission_bps, r.service_charge_percent,
            r.gstin, r.fssai, r.cover_url, c.name AS city, r.created_at
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
  gstin: z.string().trim().max(20).nullish(),
  fssai: z.string().trim().max(20).nullish(),
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
       fssai = CASE WHEN $6::boolean THEN $7 ELSE fssai END
     WHERE id = $1`,
    [
      id,
      input.commissionPercent === undefined ? null : Math.round(input.commissionPercent * 100),
      input.serviceChargePercent ?? null,
      input.gstin !== undefined,
      input.gstin ?? null,
      input.fssai !== undefined,
      input.fssai ?? null,
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
