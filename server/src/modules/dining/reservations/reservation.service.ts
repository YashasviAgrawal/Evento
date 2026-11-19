import { query, queryOne, withTransaction } from '../../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../../utils/errors';
import { readableCode } from '../../../utils/ids';
import { DINING_TZ, toLocalMoment } from '../time';
import { activeRestaurantOffers, toEngineOffer } from '../offers/offer.service';
import { bestPrebookOffer, offerHeadline } from './availability.service';
import { notifyReservation } from '../notifications';

/**
 * Reservations.
 *
 * Same three guarantees as the event booking engine: the slot row is locked
 * `FOR UPDATE`, capacity is computed under that lock, and the
 * `slots_not_overbooked` CHECK aborts the transaction even if the code above
 * it is wrong.
 */

export type ReservationStatus =
  | 'pending_payment'
  | 'placed'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled_by_diner'
  | 'cancelled_by_restaurant'
  | 'no_show'
  | 'expired';

/** Statuses that still occupy covers in a slot. */
const HOLDING: ReservationStatus[] = ['placed', 'confirmed', 'seated'];

/**
 * Every legal partner-side transition. Anything not listed is rejected, so a
 * double tap or a stale screen cannot, say, seat a cancelled table.
 */
export const PARTNER_TRANSITIONS = {
  accept: { from: ['placed'], to: 'confirmed' },
  decline: { from: ['placed', 'confirmed'], to: 'cancelled_by_restaurant' },
  seat: { from: ['placed', 'confirmed'], to: 'seated' },
  complete: { from: ['seated'], to: 'completed' },
  no_show: { from: ['confirmed', 'placed'], to: 'no_show' },
} as const satisfies Record<string, { from: readonly ReservationStatus[]; to: ReservationStatus }>;
export type PartnerAction = keyof typeof PARTNER_TRANSITIONS;

export interface CreateReservationInput {
  slotId: string;
  partySize: number;
  occasion?: string | null;
  notes?: string | null;
}

interface ReservationRow {
  id: string;
  code: string;
  user_id: string;
  restaurant_id: string;
  restaurant_slug: string;
  restaurant_name: string;
  restaurant_locality: string;
  restaurant_address: string;
  restaurant_cover: string | null;
  restaurant_phone: string | null;
  lat: string | number;
  lng: string | number;
  starts_at: Date;
  party_size: number;
  status: ReservationStatus;
  offer_snapshot: { title?: string; headline?: string } | null;
  occasion: string | null;
  notes: string | null;
  guest_name: string;
  guest_phone: string | null;
  created_at: Date;
  accepted_at: Date | null;
  seated_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
}

const RESERVATION_SELECT = `
  SELECT v.id, v.code, v.user_id, v.restaurant_id, r.slug AS restaurant_slug, r.name AS restaurant_name,
         r.locality AS restaurant_locality, r.address AS restaurant_address, r.cover_url AS restaurant_cover,
         r.phone AS restaurant_phone, r.lat, r.lng, v.starts_at, v.party_size, v.status, v.offer_snapshot,
         v.occasion, v.notes, v.guest_name, v.guest_phone, v.created_at, v.accepted_at, v.seated_at,
         v.cancelled_at, v.cancel_reason
    FROM dining.reservations v
    JOIN dining.restaurants r ON r.id = v.restaurant_id`;

function toReservation(row: ReservationRow) {
  const local = toLocalMoment(row.starts_at);
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    startsAt: row.starts_at,
    localDate: local.date,
    partySize: row.party_size,
    occasion: row.occasion,
    notes: row.notes,
    guestName: row.guest_name,
    offer: row.offer_snapshot ? { title: row.offer_snapshot.title ?? '', headline: row.offer_snapshot.headline ?? '' } : null,
    restaurant: {
      id: row.restaurant_id,
      slug: row.restaurant_slug,
      name: row.restaurant_name,
      locality: row.restaurant_locality,
      address: row.restaurant_address,
      coverUrl: row.restaurant_cover,
      phone: row.restaurant_phone,
      lat: Number(row.lat),
      lng: Number(row.lng),
    },
    canCancel: HOLDING.includes(row.status) && row.status !== 'seated' && row.starts_at.getTime() > Date.now(),
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    seatedAt: row.seated_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
  };
}
export type ReservationView = ReturnType<typeof toReservation>;

export async function createReservation(
  user: { id: string; fullName: string },
  input: CreateReservationInput,
): Promise<ReservationView> {
  const reservationId = await withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      restaurant_id: string;
      starts_at: Date;
      capacity: number;
      held: number;
      booked: number;
      max_party: number;
      is_blocked: boolean;
      status: string;
      booking_enabled: boolean;
      auto_accept: boolean;
    }>(
      `SELECT s.id, s.restaurant_id, s.starts_at, s.capacity, s.held, s.booked, s.max_party, s.is_blocked,
              r.status, r.booking_enabled, r.auto_accept
         FROM dining.slots s JOIN dining.restaurants r ON r.id = s.restaurant_id
        WHERE s.id = $1
          FOR UPDATE OF s`,
      [input.slotId],
    );
    const slot = rows[0];
    if (!slot) throw new NotFoundError('Time slot');
    if (slot.status !== 'live' || !slot.booking_enabled) {
      throw new ConflictError('This restaurant is not taking bookings right now', 'BOOKING_UNAVAILABLE');
    }
    if (slot.is_blocked || slot.starts_at.getTime() < Date.now() + 15 * 60_000) {
      throw new ConflictError('That time is no longer available — please pick another', 'SLOT_UNAVAILABLE');
    }
    if (input.partySize > slot.max_party) {
      throw new BadRequestError(`For more than ${slot.max_party} guests, please call the restaurant`, 'PARTY_TOO_LARGE');
    }
    if (slot.capacity - slot.held - slot.booked < input.partySize) {
      throw new ConflictError('That time just filled up — please pick another', 'SLOT_FULL');
    }

    // One live table per restaurant per evening: stops a diner hoarding slots.
    const { rows: existing } = await client.query<{ code: string }>(
      `SELECT code FROM dining.reservations
        WHERE user_id = $1 AND restaurant_id = $2 AND status = ANY($3::dining.reservation_status[])
          AND (starts_at AT TIME ZONE '${DINING_TZ}')::date = ($4::timestamptz AT TIME ZONE '${DINING_TZ}')::date`,
      [user.id, slot.restaurant_id, HOLDING, slot.starts_at],
    );
    if (existing[0]) {
      throw new ConflictError('You already have a table here that day', 'ALREADY_BOOKED', { code: existing[0].code });
    }

    // Promise the offer the diner saw on the slot chip, frozen as a snapshot.
    const offers = (await activeRestaurantOffers(slot.restaurant_id, client)).map(toEngineOffer);
    const offer = bestPrebookOffer(offers, toLocalMoment(slot.starts_at));

    const phone = await client.query<{ phone: string | null }>('SELECT phone FROM users WHERE id = $1', [user.id]);
    const { rows: created } = await client.query<{ id: string }>(
      `INSERT INTO dining.reservations (code, user_id, restaurant_id, slot_id, starts_at, party_size, status, offer_id,
                                        offer_snapshot, occasion, notes, guest_name, guest_phone, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::dining.reservation_status, $8, $9, $10, $11, $12, $13,
               CASE WHEN $7::dining.reservation_status = 'confirmed' THEN now() END)
       RETURNING id`,
      [
        `DIN-${readableCode(6)}`,
        user.id,
        slot.restaurant_id,
        slot.id,
        slot.starts_at,
        input.partySize,
        slot.auto_accept ? 'confirmed' : 'placed',
        offer?.id ?? null,
        offer ? JSON.stringify({ ...offer, headline: offerHeadline(offer) }) : null,
        input.occasion ?? null,
        input.notes ?? null,
        user.fullName,
        phone.rows[0]?.phone ?? null,
      ],
    );
    await client.query('UPDATE dining.slots SET booked = booked + $2 WHERE id = $1', [slot.id, input.partySize]);
    return created[0]!.id;
  });

  const reservation = await getReservationById(reservationId);
  notifyReservation(reservationId, reservation.status === 'confirmed' ? 'confirmed' : 'requested');
  return reservation;
}

async function getReservationById(id: string): Promise<ReservationView> {
  const row = await queryOne<ReservationRow>(`${RESERVATION_SELECT} WHERE v.id = $1`, [id]);
  if (!row) throw new NotFoundError('Reservation');
  return toReservation(row);
}

export async function getReservationForUser(code: string, userId: string): Promise<ReservationView> {
  const row = await queryOne<ReservationRow>(`${RESERVATION_SELECT} WHERE v.code = $1 AND v.user_id = $2`, [code, userId]);
  if (!row) throw new NotFoundError('Reservation');
  return toReservation(row);
}

export async function listReservationsForUser(userId: string): Promise<ReservationView[]> {
  const { rows } = await query<ReservationRow>(
    `${RESERVATION_SELECT} WHERE v.user_id = $1
      ORDER BY (v.starts_at >= now() - interval '3 hours') DESC,
               CASE WHEN v.starts_at >= now() - interval '3 hours' THEN v.starts_at END ASC,
               v.starts_at DESC
      LIMIT 100`,
    [userId],
  );
  return rows.map(toReservation);
}

/** Move a reservation to `to`, releasing covers when it stops holding a table. */
async function transition(
  where: { code: string; userId?: string; restaurantId?: string },
  from: readonly ReservationStatus[],
  to: ReservationStatus,
  extra: { reason?: string | null } = {},
): Promise<string> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; slot_id: string; party_size: number; status: ReservationStatus }>(
      `SELECT id, slot_id, party_size, status FROM dining.reservations
        WHERE code = $1 AND ($2::uuid IS NULL OR user_id = $2) AND ($3::uuid IS NULL OR restaurant_id = $3)
          FOR UPDATE`,
      [where.code, where.userId ?? null, where.restaurantId ?? null],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('Reservation');
    if (!from.includes(row.status)) {
      throw new ConflictError(`This reservation is ${row.status.replace(/_/g, ' ')}`, 'INVALID_TRANSITION');
    }

    const stamp: Partial<Record<ReservationStatus, string>> = {
      confirmed: 'accepted_at',
      seated: 'seated_at',
      completed: 'completed_at',
      cancelled_by_diner: 'cancelled_at',
      cancelled_by_restaurant: 'cancelled_at',
    };
    const column = stamp[to];
    await client.query(
      `UPDATE dining.reservations SET status = $2, cancel_reason = COALESCE($3, cancel_reason)
              ${column ? `, ${column} = now()` : ''}
        WHERE id = $1`,
      [row.id, to, extra.reason ?? null],
    );

    // A cancelled or declined table frees its covers for someone else.
    if (HOLDING.includes(row.status) && (to === 'cancelled_by_diner' || to === 'cancelled_by_restaurant')) {
      await client.query('UPDATE dining.slots SET booked = GREATEST(booked - $2, 0) WHERE id = $1', [row.slot_id, row.party_size]);
    }
    return row.id;
  });
}

export async function cancelByDiner(code: string, userId: string, reason?: string | null): Promise<ReservationView> {
  const current = await getReservationForUser(code, userId);
  if (!current.canCancel) throw new ConflictError('This reservation can no longer be cancelled', 'CANNOT_CANCEL');
  const id = await transition({ code, userId }, ['placed', 'confirmed'], 'cancelled_by_diner', { reason });
  notifyReservation(id, 'cancelled');
  return getReservationById(id);
}

export async function partnerTransition(
  restaurantId: string,
  code: string,
  action: PartnerAction,
  reason?: string | null,
): Promise<ReservationView> {
  const rule = PARTNER_TRANSITIONS[action];
  const id = await transition({ code, restaurantId }, rule.from, rule.to, { reason });
  if (action === 'accept') notifyReservation(id, 'accepted');
  if (action === 'decline') notifyReservation(id, 'declined');
  return getReservationById(id);
}

/** A restaurant's reservations for one local day, in seating order. */
export async function listForRestaurant(restaurantId: string, date: string): Promise<ReservationView[]> {
  const { rows } = await query<ReservationRow>(
    `${RESERVATION_SELECT}
      WHERE v.restaurant_id = $1 AND (v.starts_at AT TIME ZONE '${DINING_TZ}')::date = $2::date
      ORDER BY v.starts_at, v.created_at`,
    [restaurantId, date],
  );
  return rows.map(toReservation);
}
