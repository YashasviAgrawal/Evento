import { z } from 'zod';
import { query, queryOne, type Queryable } from '../../../db/pool';
import { NotFoundError } from '../../../utils/errors';
import { rupeesToPaise } from '../../../utils/money';
import type { EngineOffer } from './engine';

/* ───────────────────────── mapping ───────────────────────── */

export const OFFER_COLUMNS = `o.id, o.owner, o.restaurant_id, o.code, o.title, o.description, o.kind, o.percent_off,
  o.flat_off_paise, o.max_discount_paise, o.min_bill_paise, o.applies_to, o.days, o.start_time::text AS start_time,
  o.end_time::text AS end_time, o.valid_from, o.valid_until, o.per_user_limit, o.restaurant_funded_pct, o.terms, o.status,
  o.bank_name, o.payment_methods`;

export interface OfferRow {
  id: string;
  owner: EngineOffer['owner'];
  restaurant_id: string | null;
  code: string | null;
  title: string;
  description: string | null;
  kind: 'percent' | 'flat';
  percent_off: string | number | null;
  flat_off_paise: number | null;
  max_discount_paise: number | null;
  min_bill_paise: number;
  applies_to: EngineOffer['appliesTo'];
  days: number[];
  start_time: string;
  end_time: string;
  valid_from: Date | null;
  valid_until: Date | null;
  per_user_limit: number | null;
  restaurant_funded_pct: number;
  terms: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  bank_name?: string | null;
  payment_methods?: string[];
}

export function toEngineOffer(row: OfferRow): EngineOffer {
  return {
    id: row.id,
    owner: row.owner,
    code: row.code,
    title: row.title,
    kind: row.kind,
    percentOff: row.percent_off === null ? null : Number(row.percent_off),
    flatOffPaise: row.flat_off_paise === null ? null : Number(row.flat_off_paise),
    maxDiscountPaise: row.max_discount_paise === null ? null : Number(row.max_discount_paise),
    minBillPaise: Number(row.min_bill_paise),
    appliesTo: row.applies_to,
    days: row.days.map(Number),
    startTime: row.start_time,
    endTime: row.end_time,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    perUserLimit: row.per_user_limit,
    restaurantFundedPct: row.restaurant_funded_pct,
    bankName: row.bank_name ?? null,
  };
}

/** Engine offers survive a JSON round trip (reservation snapshots) with dates as strings. */
export function reviveEngineOffer(value: unknown): EngineOffer | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as EngineOffer & { validFrom: string | Date | null; validUntil: string | Date | null };
  return {
    ...raw,
    validFrom: raw.validFrom ? new Date(raw.validFrom) : null,
    validUntil: raw.validUntil ? new Date(raw.validUntil) : null,
  };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatClock(time: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`;
}

/** "Mon–Thu · all day", "Every day · 12 PM–4 PM" — validity in plain words. */
export function describeSchedule(days: number[], start: string, end: string): string {
  const sorted = [...days].sort((a, b) => a - b);
  let dayText: string;
  if (sorted.length === 7) dayText = 'Every day';
  else if (sorted.length && sorted.every((day, i) => i === 0 || day === sorted[i - 1]! + 1)) {
    dayText = `${DAY_NAMES[sorted[0]!]}–${DAY_NAMES[sorted[sorted.length - 1]!]}`;
  } else dayText = sorted.map((day) => DAY_NAMES[day]).join(', ');
  const allDay = start.startsWith('00:00') && end.startsWith('23:59');
  return `${dayText} · ${allDay ? 'all day' : `${formatClock(start)}–${formatClock(end)}`}`;
}

/** The public shape of an offer, as diners and partners see it. */
export function toPublicOffer(row: OfferRow) {
  return {
    id: row.id,
    owner: row.owner,
    code: row.code,
    title: row.title,
    description: row.description,
    kind: row.kind,
    percentOff: row.percent_off === null ? null : Number(row.percent_off),
    flatOffPaise: row.flat_off_paise === null ? null : Number(row.flat_off_paise),
    maxDiscountPaise: row.max_discount_paise === null ? null : Number(row.max_discount_paise),
    minBillPaise: Number(row.min_bill_paise),
    appliesTo: row.applies_to,
    days: row.days.map(Number),
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    schedule: describeSchedule(row.days.map(Number), row.start_time, row.end_time),
    validUntil: row.valid_until,
    perUserLimit: row.per_user_limit,
    restaurantFundedPct: row.restaurant_funded_pct,
    terms: row.terms,
    status: row.status,
    bankName: row.bank_name ?? null,
    paymentMethods: row.payment_methods ?? [],
  };
}
export type PublicOffer = ReturnType<typeof toPublicOffer>;

/* ───────────────────────── queries ───────────────────────── */

/** Automatic (code-less) restaurant offers that are switched on. */
export async function activeRestaurantOffers(restaurantId: string, client: Queryable = { query }): Promise<OfferRow[]> {
  const { rows } = await client.query<OfferRow>(
    `SELECT ${OFFER_COLUMNS} FROM dining.offers o
      WHERE o.restaurant_id = $1 AND o.owner = 'restaurant' AND o.code IS NULL AND o.status = 'active'
        AND (o.valid_until IS NULL OR o.valid_until > now())
      ORDER BY o.applies_to, o.percent_off DESC NULLS LAST, o.flat_off_paise DESC NULLS LAST`,
    [restaurantId],
  );
  return rows;
}

/** A code-redeemed offer usable at this restaurant (platform-wide or its own). */
export async function findCoupon(code: string, restaurantId: string, client: Queryable = { query }): Promise<OfferRow | null> {
  const { rows } = await client.query<OfferRow>(
    `SELECT ${OFFER_COLUMNS} FROM dining.offers o
      WHERE upper(o.code) = upper($1) AND o.status = 'active'
        AND (o.restaurant_id IS NULL OR o.restaurant_id = $2)`,
    [code.trim(), restaurantId],
  );
  return rows[0] ?? null;
}

/** Bank instant-discount offers usable at this restaurant (platform-wide or its own). */
export async function bankOffersFor(restaurantId: string, client: Queryable = { query }): Promise<OfferRow[]> {
  const { rows } = await client.query<OfferRow>(
    `SELECT ${OFFER_COLUMNS} FROM dining.offers o
      WHERE o.owner = 'bank' AND o.status = 'active' AND (o.restaurant_id IS NULL OR o.restaurant_id = $1)
        AND (o.valid_until IS NULL OR o.valid_until > now())
      ORDER BY o.percent_off DESC NULLS LAST, o.flat_off_paise DESC NULLS LAST`,
    [restaurantId],
  );
  return rows;
}

/** How often this diner has redeemed each offer on a paid bill. */
export async function usageFor(userId: string | null, offerIds: string[], client: Queryable = { query }): Promise<Record<string, number>> {
  if (!userId || offerIds.length === 0) return {};
  const { rows } = await client.query<{ offer_id: string; uses: number }>(
    `SELECT r.offer_id, count(*)::int AS uses
       FROM dining.offer_redemptions r
       JOIN dining.bill_payments b ON b.id = r.bill_payment_id
      WHERE r.user_id = $1 AND r.offer_id = ANY($2::uuid[])
        AND b.status IN ('paid', 'verified', 'disputed')
      GROUP BY r.offer_id`,
    [userId, offerIds],
  );
  return Object.fromEntries(rows.map((row) => [row.offer_id, Number(row.uses)]));
}

/* ───────────────────── partner management ───────────────────── */

const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');

export const offerInput = z
  .object({
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().max(300).nullish(),
    kind: z.enum(['percent', 'flat']),
    percentOff: z.coerce.number().min(1).max(100).nullish(),
    flatOff: z.coerce.number().min(1).max(100_000).nullish(),
    maxDiscount: z.coerce.number().min(1).max(100_000).nullish(),
    minBill: z.coerce.number().min(0).max(1_000_000).default(0),
    appliesTo: z.enum(['prebook', 'walkin', 'both']).default('both'),
    days: z.array(z.number().int().min(0).max(6)).min(1).default([0, 1, 2, 3, 4, 5, 6]),
    startTime: timeString.default('00:00'),
    endTime: timeString.default('23:59'),
    terms: z.string().trim().max(500).nullish(),
    status: z.enum(['active', 'paused']).default('active'),
  })
  .refine((v) => (v.kind === 'percent' ? Boolean(v.percentOff) : Boolean(v.flatOff)), {
    message: 'Enter how much the offer takes off',
    path: ['percentOff'],
  })
  .refine((v) => v.endTime > v.startTime, { message: 'End time must be after start time', path: ['endTime'] });
export type OfferInput = z.infer<typeof offerInput>;

function offerValues(input: OfferInput) {
  return [
    input.title,
    input.description ?? null,
    input.kind,
    input.kind === 'percent' ? input.percentOff : null,
    input.kind === 'flat' ? rupeesToPaise(input.flatOff!) : null,
    input.maxDiscount ? rupeesToPaise(input.maxDiscount) : null,
    rupeesToPaise(input.minBill),
    input.appliesTo,
    input.days,
    input.startTime,
    input.endTime === '23:59' ? '23:59:59' : input.endTime,
    input.terms ?? null,
    input.status,
  ];
}

export async function listRestaurantOffers(restaurantId: string): Promise<PublicOffer[]> {
  const { rows } = await query<OfferRow>(
    `SELECT ${OFFER_COLUMNS} FROM dining.offers o
      WHERE o.restaurant_id = $1 AND o.status <> 'archived'
      ORDER BY o.status, o.created_at DESC`,
    [restaurantId],
  );
  return rows.map(toPublicOffer);
}

export async function createRestaurantOffer(restaurantId: string, userId: string, input: OfferInput): Promise<PublicOffer> {
  const row = await queryOne<OfferRow>(
    `INSERT INTO dining.offers AS o (owner, restaurant_id, title, description, kind, percent_off, flat_off_paise,
                               max_discount_paise, min_bill_paise, applies_to, days, start_time, end_time, terms,
                               status, created_by)
     VALUES ('restaurant', $14, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $15)
     RETURNING ${OFFER_COLUMNS}`,
    [...offerValues(input), restaurantId, userId],
  );
  return toPublicOffer(row!);
}

export async function updateRestaurantOffer(restaurantId: string, offerId: string, input: OfferInput): Promise<PublicOffer> {
  // Bills and reservations snapshot the offer they used, so editing in place
  // never rewrites what a diner was promised or charged.
  const row = await queryOne<OfferRow>(
    `UPDATE dining.offers AS o SET title = $1, description = $2, kind = $3, percent_off = $4, flat_off_paise = $5,
            max_discount_paise = $6, min_bill_paise = $7, applies_to = $8, days = $9, start_time = $10,
            end_time = $11, terms = $12, status = $13
      WHERE o.id = $14 AND o.restaurant_id = $15 AND o.owner = 'restaurant' AND o.status <> 'archived'
      RETURNING ${OFFER_COLUMNS}`,
    [...offerValues(input), offerId, restaurantId],
  );
  if (!row) throw new NotFoundError('Offer');
  return toPublicOffer(row);
}

export async function archiveRestaurantOffer(restaurantId: string, offerId: string): Promise<void> {
  const { rowCount } = await query(
    `UPDATE dining.offers SET status = 'archived' WHERE id = $1 AND restaurant_id = $2 AND owner = 'restaurant'`,
    [offerId, restaurantId],
  );
  if (!rowCount) throw new NotFoundError('Offer');
}
