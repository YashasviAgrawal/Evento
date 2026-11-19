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
