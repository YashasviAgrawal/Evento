import { query, type Queryable } from '../../../db/pool';
import { DINING_TZ, toLocalMoment, timeToMinutes, type LocalMoment } from '../time';
import { activeRestaurantOffers, toEngineOffer } from '../offers/offer.service';
import type { EngineOffer } from '../offers/engine';

/**
 * Availability.
 *
 * Restaurants edit weekly *rules*; diners book *slots*. A slot row is created
 * from the rules the first time anyone asks for that day (idempotent
 * `ON CONFLICT DO NOTHING`), so there is no nightly job to forget, and the
 * booking path always has a real row to lock.
 */
export async function materializeSlots(restaurantIds: string[], date: string, client: Queryable = { query }): Promise<void> {
  if (restaurantIds.length === 0) return;
  await client.query(
    `INSERT INTO dining.slots (restaurant_id, starts_at, capacity, max_party)
     SELECT r.restaurant_id, gs, r.covers_per_slot, r.max_party
       FROM dining.inventory_rules r
       CROSS JOIN LATERAL generate_series(
         ($2::date + r.start_time) AT TIME ZONE '${DINING_TZ}',
         ($2::date + r.end_time) AT TIME ZONE '${DINING_TZ}',
         make_interval(mins => r.slot_minutes)
       ) AS gs
      WHERE r.restaurant_id = ANY($1::uuid[])
        AND r.weekday = EXTRACT(DOW FROM $2::date)
     ON CONFLICT (restaurant_id, starts_at) DO NOTHING`,
    [restaurantIds, date],
  );
}

export interface SlotView {
  id: string;
  startsAt: Date;
  /** "19:30" in restaurant-local time. */
  time: string;
  remaining: number;
  maxParty: number;
  offer: { id: string; label: string; percentOff: number | null; flatOffPaise: number | null } | null;
}

/** Headline of an offer for a slot chip: "30% off", "₹200 off". */
export function offerHeadline(offer: EngineOffer): string {
  return offer.kind === 'percent'
    ? `${Number(offer.percentOff)}% off`
    : `₹${Math.round((offer.flatOffPaise ?? 0) / 100).toLocaleString('en-IN')} off`;
}

/** Is a pre-book offer valid for a table at this local moment (bill size aside)? */
export function prebookOfferValidAt(offer: EngineOffer, at: LocalMoment): boolean {
  if (offer.appliesTo === 'walkin') return false;
  if (offer.validFrom && offer.validFrom > at.instant) return false;
  if (offer.validUntil && offer.validUntil < at.instant) return false;
  if (!offer.days.includes(at.weekday)) return false;
  return at.minutes >= timeToMinutes(offer.startTime) && at.minutes <= timeToMinutes(offer.endTime);
}

/** The deepest pre-book offer for a slot, ranked by headline percentage then flat value. */
export function bestPrebookOffer(offers: EngineOffer[], at: LocalMoment): EngineOffer | null {
  const valid = offers.filter((offer) => prebookOfferValidAt(offer, at));
  valid.sort(
    (a, b) =>
      (b.percentOff ?? 0) - (a.percentOff ?? 0) || (b.flatOffPaise ?? 0) - (a.flatOffPaise ?? 0) || a.id.localeCompare(b.id),
  );
  return valid[0] ?? null;
}

interface SlotRow {
  id: string;
  restaurant_id: string;
  starts_at: Date;
  remaining: number;
  max_party: number;
}

function toSlotView(row: SlotRow, offers: EngineOffer[]): SlotView {
  const at = toLocalMoment(row.starts_at);
  const offer = bestPrebookOffer(offers, at);
  const hh = String(Math.floor(at.minutes / 60)).padStart(2, '0');
  const mm = String(at.minutes % 60).padStart(2, '0');
  return {
    id: row.id,
    startsAt: row.starts_at,
    time: `${hh}:${mm}`,
    remaining: Number(row.remaining),
    maxParty: row.max_party,
    offer: offer
      ? { id: offer.id, label: offerHeadline(offer), percentOff: offer.percentOff, flatOffPaise: offer.flatOffPaise }
      : null,
  };
}

/** Booking lead time: a table must be booked at least this far ahead. */
const LEAD_MINUTES = 15;

/** Every slot on a local date, with what is left and the offer it carries. */
export async function slotsForDate(restaurantId: string, date: string, partySize: number) {
  await materializeSlots([restaurantId], date);
  const [{ rows }, offerRows] = await Promise.all([
    query<SlotRow>(
      `SELECT id, restaurant_id, starts_at, (capacity - held - booked)::int AS remaining, max_party
         FROM dining.slots
        WHERE restaurant_id = $1 AND NOT is_blocked
          AND (starts_at AT TIME ZONE '${DINING_TZ}')::date = $2::date
        ORDER BY starts_at`,
      [restaurantId, date],
    ),
    activeRestaurantOffers(restaurantId),
  ]);
  const offers = offerRows.map(toEngineOffer);
  const cutoff = Date.now() + LEAD_MINUTES * 60_000;
  return rows.map((row) => {
    const view = toSlotView(row, offers);
    const bookable = row.starts_at.getTime() > cutoff && view.remaining >= partySize && partySize <= view.maxParty;
    return { ...view, available: bookable };
  });
}

/** The next `limit` bookable slots today for each restaurant (for cards). */
export async function upcomingSlots(restaurantIds: string[], limit: number): Promise<Record<string, SlotView[]>> {
  if (restaurantIds.length === 0) return {};
  const { rows } = await query<SlotRow>(
    `SELECT id, restaurant_id, starts_at, remaining, max_party FROM (
       SELECT s.id, s.restaurant_id, s.starts_at, (s.capacity - s.held - s.booked)::int AS remaining, s.max_party,
              row_number() OVER (PARTITION BY s.restaurant_id ORDER BY s.starts_at) AS n
         FROM dining.slots s
        WHERE s.restaurant_id = ANY($1::uuid[]) AND NOT s.is_blocked
          AND s.starts_at > now() + make_interval(mins => $3)
          AND (s.starts_at AT TIME ZONE '${DINING_TZ}')::date = (now() AT TIME ZONE '${DINING_TZ}')::date
          AND s.capacity - s.held - s.booked >= 2
     ) t WHERE n <= $2`,
    [restaurantIds, limit, LEAD_MINUTES],
  );

  const offersByRestaurant: Record<string, EngineOffer[]> = {};
  const { rows: offerRows } = await query<{ restaurant_id: string } & Parameters<typeof toEngineOffer>[0]>(
    `SELECT o.restaurant_id, o.id, o.owner, o.code, o.title, o.description, o.kind, o.percent_off, o.flat_off_paise,
            o.max_discount_paise, o.min_bill_paise, o.applies_to, o.days, o.start_time::text AS start_time,
            o.end_time::text AS end_time, o.valid_from, o.valid_until, o.per_user_limit, o.restaurant_funded_pct,
            o.terms, o.status
       FROM dining.offers o
      WHERE o.restaurant_id = ANY($1::uuid[]) AND o.owner = 'restaurant' AND o.code IS NULL AND o.status = 'active'`,
    [restaurantIds],
  );
  for (const row of offerRows) (offersByRestaurant[row.restaurant_id] ??= []).push(toEngineOffer(row));

  const result: Record<string, SlotView[]> = {};
  for (const row of rows) {
    (result[row.restaurant_id] ??= []).push(toSlotView(row, offersByRestaurant[row.restaurant_id] ?? []));
  }
  return result;
}
