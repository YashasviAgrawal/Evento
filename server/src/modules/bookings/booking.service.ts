import type { PoolClient } from 'pg';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { dbRunner, query, queryOne, withTransaction } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors';
import { generateBookingCode } from '../../utils/ids';
import { formatEventDate } from '../../utils/dates';
import { getSettings, resolveCommissionPercent } from '../../services/settings.service';
import { sendMailAsync } from '../../services/mail.service';
import { evaluateCoupon, redeemCoupon, releaseCoupon } from '../coupons/coupon.service';
import { issueTicketsForBooking } from '../tickets/ticket.service';
import { calculatePricing, type PriceBreakdown, type PriceLine } from './pricing';
import type { CreateBookingInput, QuoteInput } from './booking.schema';

/* ─────────────────────── shared lookups ─────────────────────── */

interface EventContext {
  id: string;
  title: string;
  slug: string;
  status: string;
  starts_at: Date;
  organizer_id: string;
  commission_percent: number | null;
  venue_name: string;
  timezone: string;
}

async function loadEventForBooking(client: PoolClient | null, eventId: string): Promise<EventContext> {
  const runner = dbRunner(client);
  const { rows } = await runner.query<EventContext>(
    `SELECT e.id, e.title, e.slug, e.status, e.starts_at, e.organizer_id, e.timezone,
            o.commission_percent, v.name AS venue_name
       FROM events e
       JOIN organizers o ON o.id = e.organizer_id
       JOIN venues v     ON v.id = e.venue_id
      WHERE e.id = $1`,
    [eventId],
  );

  const event = rows[0];
  if (!event) throw new NotFoundError('Event');
  if (event.status !== 'published') {
    throw new ConflictError(
      event.status === 'paused'
        ? 'Bookings for this event are temporarily paused'
        : 'This event is not open for booking',
      'EVENT_NOT_BOOKABLE',
    );
  }
  if (event.starts_at.getTime() < Date.now()) {
    throw new ConflictError('This event has already started', 'EVENT_STARTED');
  }
  return event;
}

interface LockedTicketType {
  id: string;
  name: string;
  price_paise: number;
  quantity_total: number;
  quantity_sold: number;
  quantity_held: number;
  min_per_order: number;
  max_per_order: number;
  is_active: boolean;
  sale_starts_at: Date | null;
  sale_ends_at: Date | null;
}

/**
 * Lock the requested ticket types for update.
 *
 * `ORDER BY id` matters: every transaction acquires row locks in the same
 * order, so two concurrent bookings for the same pair of tiers queue instead
 * of deadlocking against each other.
 */
async function lockTicketTypes(
  client: PoolClient,
  eventId: string,
  ticketTypeIds: string[],
): Promise<Map<string, LockedTicketType>> {
  const { rows } = await client.query<LockedTicketType>(
    `SELECT id, name, price_paise, quantity_total, quantity_sold, quantity_held,
            min_per_order, max_per_order, is_active, sale_starts_at, sale_ends_at
       FROM ticket_types
      WHERE event_id = $1 AND id = ANY($2::uuid[])
      ORDER BY id
      FOR UPDATE`,
    [eventId, ticketTypeIds],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Validate one requested line against its (locked) ticket type and return the
 * priced line. Every rule the PRD specifies for a ticket type is enforced here.
 */
function validateLine(
  ticketType: LockedTicketType | undefined,
  requested: { ticketTypeId: string; quantity: number },
  alreadyOwned: number,
): PriceLine {
  if (!ticketType) throw new NotFoundError('Ticket type', 'TICKET_TYPE_NOT_FOUND');
  if (!ticketType.is_active) {
    throw new ConflictError(`"${ticketType.name}" is no longer on sale`, 'TICKET_TYPE_INACTIVE');
  }

  const now = Date.now();
  if (ticketType.sale_starts_at && ticketType.sale_starts_at.getTime() > now) {
    throw new ConflictError(`Sales for "${ticketType.name}" have not started yet`, 'SALE_NOT_STARTED');
  }
  if (ticketType.sale_ends_at && ticketType.sale_ends_at.getTime() < now) {
    throw new ConflictError(`Sales for "${ticketType.name}" have ended`, 'SALE_ENDED');
  }

  if (requested.quantity < ticketType.min_per_order) {
    throw new BadRequestError(
      `Minimum ${ticketType.min_per_order} ticket(s) per order for "${ticketType.name}"`,
      'BELOW_MIN_PER_ORDER',
    );
  }
  if (requested.quantity > ticketType.max_per_order) {
    throw new BadRequestError(
      `Maximum ${ticketType.max_per_order} ticket(s) per order for "${ticketType.name}"`,
      'ABOVE_MAX_PER_ORDER',
    );
  }
  // The per-order cap also acts as a per-customer cap across separate orders,
  // otherwise a limit of 4 is trivially bypassed by placing five orders.
  if (alreadyOwned + requested.quantity > ticketType.max_per_order) {
    throw new BadRequestError(
      `You can book at most ${ticketType.max_per_order} ticket(s) of "${ticketType.name}" — you already have ${alreadyOwned}`,
      'BOOKING_LIMIT_REACHED',
    );
  }

  const available =
    Number(ticketType.quantity_total) - Number(ticketType.quantity_sold) - Number(ticketType.quantity_held);
  if (available < requested.quantity) {
    throw new ConflictError(
      available <= 0
        ? `"${ticketType.name}" is sold out`
        : `Only ${available} ticket(s) left for "${ticketType.name}"`,
      'INSUFFICIENT_INVENTORY',
      { available },
    );
  }

  return {
    ticketTypeId: ticketType.id,
    name: ticketType.name,
    unitPricePaise: Number(ticketType.price_paise),
    quantity: requested.quantity,
    subtotalPaise: Number(ticketType.price_paise) * requested.quantity,
  };
}

/** How many tickets of each type the user already holds on live bookings. */
async function countExistingTickets(
  client: PoolClient,
  userId: string,
  eventId: string,
): Promise<Map<string, number>> {
  const { rows } = await client.query<{ ticket_type_id: string; total: number }>(
    `SELECT bi.ticket_type_id, COALESCE(sum(bi.quantity), 0)::int AS total
       FROM booking_items bi
       JOIN bookings b ON b.id = bi.booking_id
      WHERE b.user_id = $1 AND b.event_id = $2
        AND b.status IN ('pending', 'confirmed')
      GROUP BY bi.ticket_type_id`,
    [userId, eventId],
  );
  return new Map(rows.map((row) => [row.ticket_type_id, Number(row.total)]));
}

/* ───────────────────────── quote ───────────────────────── */

/**
 * Price a cart without reserving anything. Backs the live order summary on the
 * checkout page, including coupon preview.
 */
export async function quoteBooking(
  input: QuoteInput,
  userId: string,
): Promise<PriceBreakdown & { couponCode?: string; couponError?: string }> {
  const event = await loadEventForBooking(null, input.eventId);
  const settings = await getSettings();

  const { rows } = await query<LockedTicketType>(
    `SELECT id, name, price_paise, quantity_total, quantity_sold, quantity_held,
            min_per_order, max_per_order, is_active, sale_starts_at, sale_ends_at
       FROM ticket_types WHERE event_id = $1 AND id = ANY($2::uuid[])`,
    [input.eventId, input.items.map((item) => item.ticketTypeId)],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  const lines = input.items.map((item) => validateLine(byId.get(item.ticketTypeId), item, 0));
  const subtotal = lines.reduce((sum, line) => sum + line.subtotalPaise, 0);

  let discount = 0;
  let couponCode: string | undefined;
  let couponError: string | undefined;

  if (input.couponCode) {
    try {
      const result = await evaluateCoupon({
        code: input.couponCode,
        subtotalPaise: subtotal,
        eventId: input.eventId,
        organizerId: event.organizer_id,
        userId,
      });
      discount = result.discountPaise;
      couponCode = result.coupon.code;
    } catch (err) {
      // A bad coupon must not block the quote — the cart total is still valid.
      couponError = err instanceof Error ? err.message : 'Coupon could not be applied';
    }
  }

  const commissionPercent = await resolveCommissionPercent(event.commission_percent);
  const breakdown = calculatePricing(lines, discount, {
    taxPercent: Number(settings.tax_percent),
    convenienceFeePercent: Number(settings.convenience_fee_percent),
    commissionPercent,
  });

  return { ...breakdown, couponCode, couponError };
}

/* ─────────────────────── create booking ─────────────────────── */

export interface CreatedBooking {
  id: string;
  bookingCode: string;
  status: string;
  totalPaise: number;
  holdExpiresAt: Date | null;
  requiresPayment: boolean;
  breakdown: PriceBreakdown;
}

/**
 * Reserve inventory and create a pending booking.
 *
 * The whole thing is one transaction:
 *   1. lock the ticket-type rows          (blocks concurrent buyers)
 *   2. re-validate availability and rules (under the lock, so it is truthful)
 *   3. increment quantity_held            (the actual reservation)
 *   4. write booking + items + coupon redemption
 *
 * If anything throws, the reservation never happened. The CHECK constraint
 * `ticket_types_not_oversold` is the backstop: even a logic regression here
 * cannot oversell, the transaction would abort instead.
 *
 * Free events skip the payment step and are confirmed immediately.
 */
export async function createBooking(userId: string, input: CreateBookingInput): Promise<CreatedBooking> {
  const settings = await getSettings();

  const result = await withTransaction(async (client) => {
    const event = await loadEventForBooking(client, input.eventId);

    // Merge duplicate lines so a client sending the same tier twice cannot
    // sidestep the per-order maximum.
    const merged = new Map<string, number>();
    for (const item of input.items) {
      merged.set(item.ticketTypeId, (merged.get(item.ticketTypeId) ?? 0) + item.quantity);
    }
    const items = [...merged.entries()].map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));

    const locked = await lockTicketTypes(client, input.eventId, items.map((item) => item.ticketTypeId));
    const owned = await countExistingTickets(client, userId, input.eventId);

    const lines = items.map((item) =>
      validateLine(locked.get(item.ticketTypeId), item, owned.get(item.ticketTypeId) ?? 0),
    );

    const subtotal = lines.reduce((sum, line) => sum + line.subtotalPaise, 0);

    let discount = 0;
    let couponId: string | null = null;
    let couponCode: string | null = null;
    if (input.couponCode) {
      const evaluated = await evaluateCoupon({
        code: input.couponCode,
        subtotalPaise: subtotal,
        eventId: input.eventId,
        organizerId: event.organizer_id,
        userId,
        client,
      });
      discount = evaluated.discountPaise;
      couponId = evaluated.coupon.id;
      couponCode = evaluated.coupon.code;
    }

    const commissionPercent = await resolveCommissionPercent(event.commission_percent, client);
    const breakdown = calculatePricing(lines, discount, {
      taxPercent: Number(settings.tax_percent),
      convenienceFeePercent: Number(settings.convenience_fee_percent),
      commissionPercent,
    });

    const isFree = breakdown.totalPaise === 0;
    const holdExpiresAt = isFree
      ? null
      : new Date(Date.now() + Number(settings.booking_hold_minutes) * 60_000);

    const { rows: bookingRows } = await client.query<{ id: string; booking_code: string }>(
      `INSERT INTO bookings (booking_code, user_id, event_id, organizer_id, status, quantity,
                             subtotal_paise, discount_paise, tax_paise, convenience_fee_paise, total_paise,
                             commission_percent, commission_paise, organizer_payout_paise,
                             coupon_id, coupon_code, customer_name, customer_email, customer_phone, notes,
                             hold_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id, booking_code`,
      [
        generateBookingCode(),
        userId,
        input.eventId,
        event.organizer_id,
        'pending',
        breakdown.quantity,
        breakdown.subtotalPaise,
        breakdown.discountPaise,
        breakdown.taxPaise,
        breakdown.convenienceFeePaise,
        breakdown.totalPaise,
        breakdown.commissionPercent,
        breakdown.commissionPaise,
        breakdown.organizerPayoutPaise,
        couponId,
        couponCode,
        input.customerName,
        input.customerEmail,
        input.customerPhone,
        input.notes ?? null,
        holdExpiresAt,
      ],
    );
    const booking = bookingRows[0]!;

    for (const line of lines) {
      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, ticket_type_name, unit_price_paise, quantity, subtotal_paise)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [booking.id, line.ticketTypeId, line.name, line.unitPricePaise, line.quantity, line.subtotalPaise],
      );

      // The reservation itself. The not-oversold CHECK constraint fires here
      // if this would push sold + held past capacity.
      await client.query('UPDATE ticket_types SET quantity_held = quantity_held + $2 WHERE id = $1', [
        line.ticketTypeId,
        line.quantity,
      ]);
    }

    if (couponId) {
      await redeemCoupon(client, {
        couponId,
        bookingId: booking.id,
        userId,
        discountPaise: breakdown.discountPaise,
      });
    }

    return {
      id: booking.id,
      bookingCode: booking.booking_code,
      status: 'pending',
      totalPaise: breakdown.totalPaise,
      holdExpiresAt,
      requiresPayment: !isFree,
      breakdown,
    };
  });

  // A free booking has nothing to pay for, so it is confirmed straight away.
  if (!result.requiresPayment) {
    await confirmBooking(result.id, { method: 'mock', reference: 'FREE-TICKET' });
    return { ...result, status: 'confirmed' };
  }

  return result;
}

/* ─────────────────────── confirm / expire ─────────────────────── */

export interface ConfirmContext {
  method?: string;
  reference?: string;
  paymentId?: string;
}

/**
 * Move a booking from pending to confirmed: convert the inventory hold into a
 * sale, issue tickets, and email the customer.
 *
 * Idempotent — the guarded UPDATE only matches a booking still in `pending`,
 * so a duplicated webhook and a client-side verify racing each other cannot
 * both decrement inventory or issue two sets of tickets.
 */
export async function confirmBooking(bookingId: string, context: ConfirmContext = {}): Promise<boolean> {
  const confirmed = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; event_id: string; user_id: string; quantity: number }>(
      `UPDATE bookings
          SET status = 'confirmed', confirmed_at = now(), hold_expires_at = NULL
        WHERE id = $1 AND status = 'pending'
        RETURNING id, event_id, user_id, quantity`,
      [bookingId],
    );
    const booking = rows[0];
    if (!booking) return null; // already confirmed, expired or cancelled

    const { rows: items } = await client.query<{ ticket_type_id: string; quantity: number }>(
      'SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1 ORDER BY ticket_type_id',
      [bookingId],
    );

    for (const item of items) {
      await client.query(
        `UPDATE ticket_types
            SET quantity_held = GREATEST(0, quantity_held - $2),
                quantity_sold = quantity_sold + $2
          WHERE id = $1`,
        [item.ticket_type_id, item.quantity],
      );
    }

    await client.query(
      `UPDATE events SET tickets_sold = tickets_sold + $2 WHERE id = $1`,
      [booking.event_id, booking.quantity],
    );

    await issueTicketsForBooking(client, bookingId);
    return booking;
  });

  if (!confirmed) return false;

  await sendBookingConfirmation(bookingId).catch((err) =>
    logger.error({ err, bookingId }, 'Failed to send booking confirmation'),
  );
  logger.info({ bookingId, method: context.method }, 'Booking confirmed');
  return true;
}

async function sendBookingConfirmation(bookingId: string): Promise<void> {
  const row = await queryOne<{
    booking_code: string;
    customer_name: string;
    customer_email: string;
    quantity: number;
    total_paise: number;
    user_id: string;
    event_id: string;
    title: string;
    starts_at: Date;
    timezone: string;
    venue_name: string;
  }>(
    `SELECT b.booking_code, b.customer_name, b.customer_email, b.quantity, b.total_paise,
            b.user_id, b.event_id, e.title, e.starts_at, e.timezone, v.name AS venue_name
       FROM bookings b
       JOIN events e ON e.id = b.event_id
       JOIN venues v ON v.id = e.venue_id
      WHERE b.id = $1`,
    [bookingId],
  );
  if (!row) return;

  sendMailAsync({
    to: row.customer_email,
    template: 'booking_confirmed',
    data: {
      name: row.customer_name,
      bookingCode: row.booking_code,
      eventTitle: row.title,
      eventDate: formatEventDate(row.starts_at, row.timezone),
      venue: row.venue_name,
      quantity: Number(row.quantity),
      totalPaise: Number(row.total_paise),
      ticketUrl: `${env.webBaseUrl}/account/bookings/${bookingId}`,
    },
    userId: row.user_id,
    bookingId,
    eventId: row.event_id,
  });
}

/**
 * Release inventory held by pending bookings whose hold has lapsed.
 *
 * Runs on a timer (see jobs/scheduler.ts) and also opportunistically before
 * availability is read, so an abandoned checkout frees its seats promptly
 * rather than at the next tick.
 */
export async function expireStaleBookings(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows: expired } = await client.query<{ id: string }>(
      `UPDATE bookings
          SET status = 'expired', cancelled_at = now(), cancellation_reason = 'Payment window elapsed'
        WHERE status = 'pending' AND hold_expires_at IS NOT NULL AND hold_expires_at < now()
        RETURNING id`,
    );
    if (expired.length === 0) return 0;

    const ids = expired.map((row) => row.id);

    // Give the seats back, then unwind any coupon the abandoned cart consumed.
    await client.query(
      `UPDATE ticket_types tt
          SET quantity_held = GREATEST(0, tt.quantity_held - agg.qty)
         FROM (
           SELECT ticket_type_id, sum(quantity)::int AS qty
             FROM booking_items
            WHERE booking_id = ANY($1::uuid[])
            GROUP BY ticket_type_id
         ) agg
        WHERE tt.id = agg.ticket_type_id`,
      [ids],
    );

    for (const id of ids) {
      await releaseCoupon(client, id);
    }

    logger.info({ count: expired.length }, 'Released inventory from expired bookings');
    return expired.length;
  });
}

/* ─────────────────────── cancel booking ─────────────────────── */

/**
 * Cancel a booking.
 *
 * A pending booking simply releases its hold. A confirmed booking returns the
 * tickets to inventory, voids them, and — when it was paid for — opens a
 * refund request for admin approval rather than refunding money automatically.
 */
export async function cancelBooking(
  bookingId: string,
  actor: { id: string; role: string },
  reason: string,
): Promise<{ status: string; refundRequested: boolean }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      user_id: string;
      status: string;
      total_paise: number;
      event_id: string;
      quantity: number;
      customer_email: string;
      customer_name: string;
      booking_code: string;
      starts_at: Date;
      title: string;
    }>(
      `SELECT b.id, b.user_id, b.status, b.total_paise, b.event_id, b.quantity,
              b.customer_email, b.customer_name, b.booking_code, e.starts_at, e.title
         FROM bookings b
         JOIN events e ON e.id = b.event_id
        WHERE b.id = $1
        FOR UPDATE OF b`,
      [bookingId],
    );
    const booking = rows[0];
    if (!booking) throw new NotFoundError('Booking');

    if (actor.role !== 'admin' && booking.user_id !== actor.id) {
      throw new ForbiddenError('This booking belongs to another account');
    }
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new ConflictError(`A ${booking.status} booking cannot be cancelled`, 'INVALID_TRANSITION');
    }

    const settings = await getSettings(client);
    const hoursToEvent = (booking.starts_at.getTime() - Date.now()) / 3_600_000;
    const withinRefundWindow = hoursToEvent >= Number(settings.refund_window_hours);

    if (actor.role !== 'admin' && booking.status === 'confirmed' && !withinRefundWindow) {
      throw new ConflictError(
        `Bookings can only be cancelled at least ${settings.refund_window_hours} hours before the event`,
        'REFUND_WINDOW_CLOSED',
      );
    }

    const { rows: items } = await client.query<{ ticket_type_id: string; quantity: number }>(
      'SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1 ORDER BY ticket_type_id',
      [bookingId],
    );

    const wasConfirmed = booking.status === 'confirmed';
    for (const item of items) {
      if (wasConfirmed) {
        await client.query(
          'UPDATE ticket_types SET quantity_sold = GREATEST(0, quantity_sold - $2) WHERE id = $1',
          [item.ticket_type_id, item.quantity],
        );
      } else {
        await client.query(
          'UPDATE ticket_types SET quantity_held = GREATEST(0, quantity_held - $2) WHERE id = $1',
          [item.ticket_type_id, item.quantity],
        );
      }
    }

    if (wasConfirmed) {
      await client.query('UPDATE events SET tickets_sold = GREATEST(0, tickets_sold - $2) WHERE id = $1', [
        booking.event_id,
        booking.quantity,
      ]);
      await client.query("UPDATE tickets SET status = 'cancelled' WHERE booking_id = $1", [bookingId]);
    } else {
      await releaseCoupon(client, bookingId);
    }

    await client.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $2 WHERE id = $1`,
      [bookingId, reason],
    );

    // Money already captured is never refunded silently — it becomes a refund
    // request that an admin reviews, per the PRD's "Refund Approval" flow.
    let refundRequested = false;
    if (wasConfirmed && Number(booking.total_paise) > 0) {
      const { rows: paymentRows } = await client.query<{ id: string }>(
        `SELECT id FROM payments WHERE booking_id = $1 AND status = 'success' ORDER BY created_at DESC LIMIT 1`,
        [bookingId],
      );
      await client.query(
        `INSERT INTO refunds (booking_id, payment_id, requested_by, amount_paise, reason, status)
         VALUES ($1, $2, $3, $4, $5, 'requested')`,
        [bookingId, paymentRows[0]?.id ?? null, actor.id, booking.total_paise, reason],
      );
      refundRequested = true;
    }

    sendMailAsync({
      to: booking.customer_email,
      template: 'booking_cancelled',
      data: {
        name: booking.customer_name,
        bookingCode: booking.booking_code,
        eventTitle: booking.title,
        reason,
        refundPaise: refundRequested ? Number(booking.total_paise) : 0,
      },
      userId: booking.user_id,
      bookingId,
    });

    return { status: 'cancelled', refundRequested };
  });
}

/* ─────────────────────── read models ─────────────────────── */

export async function listUserBookings(
  userId: string,
  params: { status?: string; scope: string; page: number; limit: number },
): Promise<{ items: unknown[]; total: number }> {
  const conditions = ['b.user_id = $1'];
  const values: unknown[] = [userId];

  if (params.status) {
    values.push(params.status);
    conditions.push(`b.status = $${values.length}::booking_status`);
  }
  if (params.scope === 'upcoming') conditions.push('e.starts_at >= now()');
  if (params.scope === 'past') conditions.push('e.starts_at < now()');

  const where = `WHERE ${conditions.join(' AND ')}`;
  const offset = (params.page - 1) * params.limit;
  values.push(params.limit, offset);

  const [list, count] = await Promise.all([
    query(
      `SELECT b.id, b.booking_code, b.status, b.quantity, b.total_paise, b.created_at, b.confirmed_at,
              e.id AS event_id, e.title, e.slug, e.starts_at, e.banner_url, e.thumbnail_url, e.timezone,
              v.name AS venue_name, ci.name AS city_name,
              (SELECT count(*)::int FROM tickets t WHERE t.booking_id = b.id AND t.status = 'valid') AS valid_tickets
         FROM bookings b
         JOIN events e  ON e.id = b.event_id
         JOIN venues v  ON v.id = e.venue_id
         JOIN cities ci ON ci.id = e.city_id
         ${where}
         ORDER BY b.created_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    ),
    query<{ total: number }>(
      `SELECT count(*)::int AS total FROM bookings b JOIN events e ON e.id = b.event_id ${where}`,
      values.slice(0, values.length - 2),
    ),
  ]);

  return {
    items: list.rows.map((row) => ({
      id: row.id,
      bookingCode: row.booking_code,
      status: row.status,
      quantity: Number(row.quantity),
      totalPaise: Number(row.total_paise),
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      validTickets: Number(row.valid_tickets),
      event: {
        id: row.event_id,
        title: row.title,
        slug: row.slug,
        startsAt: row.starts_at,
        bannerUrl: row.banner_url,
        thumbnailUrl: row.thumbnail_url ?? row.banner_url,
        timezone: row.timezone,
        venueName: row.venue_name,
        cityName: row.city_name,
      },
    })),
    total: count.rows[0]?.total ?? 0,
  };
}

export async function getBookingDetail(bookingId: string, viewer: { id: string; role: string; organizerId?: string }) {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT b.*, e.title, e.slug, e.starts_at, e.ends_at, e.timezone, e.banner_url, e.thumbnail_url,
            v.name AS venue_name, v.address_line1, v.address_line2, v.latitude, v.longitude, v.google_maps_url,
            ci.name AS city_name,
            o.display_name AS organizer_name, o.support_email AS organizer_email, o.support_phone AS organizer_phone
       FROM bookings b
       JOIN events e     ON e.id = b.event_id
       JOIN venues v     ON v.id = e.venue_id
       JOIN cities ci    ON ci.id = e.city_id
       JOIN organizers o ON o.id = b.organizer_id
      WHERE b.id = $1`,
    [bookingId],
  );
  if (!row) throw new NotFoundError('Booking');

  const isOwner = row.user_id === viewer.id;
  const isOrganizer = viewer.organizerId && row.organizer_id === viewer.organizerId;
  if (!isOwner && !isOrganizer && viewer.role !== 'admin') {
    throw new ForbiddenError('This booking belongs to another account');
  }

  const [items, tickets, payments] = await Promise.all([
    query(
      `SELECT id, ticket_type_id, ticket_type_name, unit_price_paise, quantity, subtotal_paise
         FROM booking_items WHERE booking_id = $1`,
      [bookingId],
    ),
    query(
      `SELECT id, ticket_code, attendee_name, status, seat_label, checked_in_at
         FROM tickets WHERE booking_id = $1 ORDER BY created_at ASC`,
      [bookingId],
    ),
    query(
      `SELECT id, provider, provider_order_id, provider_payment_id, amount_paise, status, method, created_at
         FROM payments WHERE booking_id = $1 ORDER BY created_at DESC`,
      [bookingId],
    ),
  ]);

  return {
    id: row.id,
    bookingCode: row.booking_code,
    status: row.status,
    quantity: Number(row.quantity),
    subtotalPaise: Number(row.subtotal_paise),
    discountPaise: Number(row.discount_paise),
    taxPaise: Number(row.tax_paise),
    convenienceFeePaise: Number(row.convenience_fee_paise),
    totalPaise: Number(row.total_paise),
    refundedPaise: Number(row.refunded_paise),
    couponCode: row.coupon_code,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    notes: row.notes,
    holdExpiresAt: row.hold_expires_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    event: {
      id: row.event_id,
      title: row.title,
      slug: row.slug,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timezone: row.timezone,
      bannerUrl: row.banner_url,
      thumbnailUrl: row.thumbnail_url ?? row.banner_url,
      venueName: row.venue_name,
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      cityName: row.city_name,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      googleMapsUrl: row.google_maps_url,
    },
    organizer: {
      name: row.organizer_name,
      email: row.organizer_email,
      phone: row.organizer_phone,
    },
    items: items.rows.map((item) => ({
      id: item.id,
      ticketTypeId: item.ticket_type_id,
      name: item.ticket_type_name,
      unitPricePaise: Number(item.unit_price_paise),
      quantity: Number(item.quantity),
      subtotalPaise: Number(item.subtotal_paise),
    })),
    tickets: tickets.rows.map((ticket) => ({
      id: ticket.id,
      ticketCode: ticket.ticket_code,
      attendeeName: ticket.attendee_name,
      status: ticket.status,
      seatLabel: ticket.seat_label,
      checkedInAt: ticket.checked_in_at,
    })),
    payments: payments.rows.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      orderId: payment.provider_order_id,
      paymentId: payment.provider_payment_id,
      amountPaise: Number(payment.amount_paise),
      status: payment.status,
      method: payment.method,
      createdAt: payment.created_at,
    })),
  };
}
