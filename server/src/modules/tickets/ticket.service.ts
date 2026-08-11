import type { PoolClient } from 'pg';
import QRCode from 'qrcode';
import { query, queryOne, withTransaction } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors';
import { generateTicketCode } from '../../utils/ids';
import { buildQrPayload, parseQrPayload, signTicket, verifyTicketSignature } from '../../utils/signing';

/**
 * Issue one ticket row per ticket purchased.
 *
 * A "Couple Pass" or "Group Pass" is still a single ticket — it just admits
 * `seats_per_ticket` people, which the seat label records so a gate attendant
 * knows how many to let in on one scan.
 */
export async function issueTicketsForBooking(client: PoolClient, bookingId: string): Promise<number> {
  const { rows: existing } = await client.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM tickets WHERE booking_id = $1',
    [bookingId],
  );
  // Guard against double issuance if a confirm path is ever retried.
  if (Number(existing[0]?.count ?? 0) > 0) return 0;

  const { rows: bookingRows } = await client.query<{
    event_id: string;
    customer_name: string;
  }>('SELECT event_id, customer_name FROM bookings WHERE id = $1', [bookingId]);
  const booking = bookingRows[0];
  if (!booking) throw new NotFoundError('Booking');

  const { rows: items } = await client.query<{
    id: string;
    ticket_type_id: string;
    ticket_type_name: string;
    quantity: number;
    seats_per_ticket: number;
  }>(
    `SELECT bi.id, bi.ticket_type_id, bi.ticket_type_name, bi.quantity, tt.seats_per_ticket
       FROM booking_items bi
       JOIN ticket_types tt ON tt.id = bi.ticket_type_id
      WHERE bi.booking_id = $1
      ORDER BY bi.created_at ASC`,
    [bookingId],
  );

  let issued = 0;
  for (const item of items) {
    for (let index = 0; index < Number(item.quantity); index += 1) {
      const ticketCode = generateTicketCode();
      const seats = Number(item.seats_per_ticket);
      const seatLabel = seats > 1 ? `${item.ticket_type_name} · admits ${seats}` : item.ticket_type_name;

      await client.query(
        `INSERT INTO tickets (ticket_code, booking_id, booking_item_id, event_id, ticket_type_id,
                              attendee_name, seat_label, qr_signature)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          ticketCode,
          bookingId,
          item.id,
          booking.event_id,
          item.ticket_type_id,
          booking.customer_name,
          seatLabel,
          signTicket(ticketCode, booking.event_id),
        ],
      );
      issued += 1;
    }
  }

  return issued;
}

export interface TicketView {
  id: string;
  ticketCode: string;
  attendeeName: string;
  seatLabel: string | null;
  status: string;
  checkedInAt: Date | null;
  qrPayload: string;
  qrDataUrl: string;
  event: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    venueName: string;
    addressLine1: string;
    cityName: string;
  };
  bookingCode: string;
  ticketTypeName: string;
}

/** Render the QR as a data URL suitable for both the web view and the PDF. */
export async function renderQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#18181b', light: '#ffffff' },
  });
}

export async function getTicketsForBooking(
  bookingId: string,
  viewer: { id: string; role: string; organizerId?: string },
): Promise<TicketView[]> {
  const booking = await queryOne<{ user_id: string; organizer_id: string; booking_code: string; status: string }>(
    'SELECT user_id, organizer_id, booking_code, status FROM bookings WHERE id = $1',
    [bookingId],
  );
  if (!booking) throw new NotFoundError('Booking');

  const allowed =
    booking.user_id === viewer.id ||
    viewer.role === 'admin' ||
    (viewer.organizerId && booking.organizer_id === viewer.organizerId);
  if (!allowed) throw new ForbiddenError('This booking belongs to another account');

  const { rows } = await query<Record<string, unknown>>(
    `SELECT t.id, t.ticket_code, t.attendee_name, t.seat_label, t.status, t.checked_in_at, t.event_id,
            tt.name AS ticket_type_name,
            e.title, e.starts_at, e.ends_at, e.timezone,
            v.name AS venue_name, v.address_line1, ci.name AS city_name
       FROM tickets t
       JOIN ticket_types tt ON tt.id = t.ticket_type_id
       JOIN events e        ON e.id = t.event_id
       JOIN venues v        ON v.id = e.venue_id
       JOIN cities ci       ON ci.id = e.city_id
      WHERE t.booking_id = $1
      ORDER BY t.created_at ASC`,
    [bookingId],
  );

  return Promise.all(
    rows.map(async (row) => {
      const payload = buildQrPayload(row.ticket_code as string, row.event_id as string);
      return {
        id: row.id as string,
        ticketCode: row.ticket_code as string,
        attendeeName: row.attendee_name as string,
        seatLabel: row.seat_label as string | null,
        status: row.status as string,
        checkedInAt: row.checked_in_at as Date | null,
        qrPayload: payload,
        qrDataUrl: await renderQrDataUrl(payload),
        bookingCode: booking.booking_code,
        ticketTypeName: row.ticket_type_name as string,
        event: {
          id: row.event_id as string,
          title: row.title as string,
          startsAt: row.starts_at as Date,
          endsAt: row.ends_at as Date,
          timezone: row.timezone as string,
          venueName: row.venue_name as string,
          addressLine1: row.address_line1 as string,
          cityName: row.city_name as string,
        },
      };
    }),
  );
}

/* ─────────────────────────── check-in ─────────────────────────── */

export interface CheckInResult {
  status: 'admitted' | 'already_used' | 'invalid' | 'wrong_event' | 'cancelled';
  message: string;
  ticket?: {
    ticketCode: string;
    attendeeName: string;
    ticketTypeName: string;
    seatLabel: string | null;
    bookingCode: string;
    checkedInAt: Date | null;
    eventTitle: string;
  };
}

/**
 * Verify a scanned QR payload and admit the holder.
 *
 * Two layers of defence:
 *  1. The HMAC signature is checked before any lookup, so a fabricated code is
 *     rejected without touching the database.
 *  2. Admission is a conditional UPDATE (`WHERE status = 'valid'`). Because
 *     the state transition and the check are the same statement, two gate
 *     staff scanning the same ticket simultaneously cannot both be told
 *     "admitted" — exactly one UPDATE matches a row.
 */
export async function checkInTicket(
  rawPayload: string,
  scanner: { id: string; role: string; organizerId?: string },
  expectedEventId?: string,
): Promise<CheckInResult> {
  const parsed = parseQrPayload(rawPayload);
  if (!parsed) {
    return { status: 'invalid', message: 'Unrecognised ticket code' };
  }

  const ticket = await queryOne<{
    id: string;
    event_id: string;
    status: string;
    attendee_name: string;
    seat_label: string | null;
    checked_in_at: Date | null;
    organizer_id: string;
    booking_code: string;
    booking_status: string;
    ticket_type_name: string;
    event_title: string;
  }>(
    `SELECT t.id, t.event_id, t.status, t.attendee_name, t.seat_label, t.checked_in_at,
            b.organizer_id, b.booking_code, b.status AS booking_status,
            tt.name AS ticket_type_name, e.title AS event_title
       FROM tickets t
       JOIN bookings b      ON b.id = t.booking_id
       JOIN ticket_types tt ON tt.id = t.ticket_type_id
       JOIN events e        ON e.id = t.event_id
      WHERE t.ticket_code = $1`,
    [parsed.ticketCode],
  );

  if (!ticket) return { status: 'invalid', message: 'Ticket not found' };

  if (!verifyTicketSignature(parsed.ticketCode, ticket.event_id, parsed.signature)) {
    return { status: 'invalid', message: 'This ticket failed verification' };
  }

  // Only the event's own organizer (or an admin) may admit its attendees.
  if (scanner.role !== 'admin' && ticket.organizer_id !== scanner.organizerId) {
    throw new ForbiddenError('You cannot scan tickets for another organizer’s event');
  }
  if (expectedEventId && ticket.event_id !== expectedEventId) {
    return { status: 'wrong_event', message: 'This ticket is for a different event' };
  }

  const summary = {
    ticketCode: parsed.ticketCode,
    attendeeName: ticket.attendee_name,
    ticketTypeName: ticket.ticket_type_name,
    seatLabel: ticket.seat_label,
    bookingCode: ticket.booking_code,
    checkedInAt: ticket.checked_in_at,
    eventTitle: ticket.event_title,
  };

  if (ticket.status === 'cancelled' || ticket.status === 'refunded') {
    return { status: 'cancelled', message: `This ticket was ${ticket.status}`, ticket: summary };
  }

  const { rows } = await query<{ checked_in_at: Date }>(
    `UPDATE tickets
        SET status = 'used', checked_in_at = now(), checked_in_by = $2
      WHERE id = $1 AND status = 'valid'
      RETURNING checked_in_at`,
    [ticket.id, scanner.id],
  );

  if (rows.length === 0) {
    return {
      status: 'already_used',
      message: ticket.checked_in_at
        ? `Already checked in at ${ticket.checked_in_at.toLocaleTimeString('en-IN')}`
        : 'This ticket has already been used',
      ticket: summary,
    };
  }

  return {
    status: 'admitted',
    message: `Welcome, ${ticket.attendee_name}`,
    ticket: { ...summary, checkedInAt: rows[0]!.checked_in_at },
  };
}

/** Undo an accidental scan. */
export async function undoCheckIn(ticketId: string, scanner: { role: string; organizerId?: string }): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ organizer_id: string }>(
      `SELECT b.organizer_id FROM tickets t JOIN bookings b ON b.id = t.booking_id WHERE t.id = $1`,
      [ticketId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('Ticket');
    if (scanner.role !== 'admin' && row.organizer_id !== scanner.organizerId) {
      throw new ForbiddenError('You cannot modify tickets for another organizer’s event');
    }

    const { rowCount } = await client.query(
      `UPDATE tickets SET status = 'valid', checked_in_at = NULL, checked_in_by = NULL
        WHERE id = $1 AND status = 'used'`,
      [ticketId],
    );
    if (!rowCount) throw new ConflictError('This ticket is not checked in', 'NOT_CHECKED_IN');
  });
}

/** Live attendance counters for the scanner screen. */
export async function getCheckInStats(eventId: string): Promise<{
  total: number;
  checkedIn: number;
  remaining: number;
  cancelled: number;
}> {
  const row = await queryOne<{ total: number; checked_in: number; cancelled: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'used')::int AS checked_in,
            count(*) FILTER (WHERE status IN ('cancelled', 'refunded'))::int AS cancelled
       FROM tickets WHERE event_id = $1`,
    [eventId],
  );
  const total = row?.total ?? 0;
  const checkedIn = row?.checked_in ?? 0;
  const cancelled = row?.cancelled ?? 0;
  return { total, checkedIn, cancelled, remaining: Math.max(0, total - checkedIn - cancelled) };
}

/** Look a ticket up without admitting it — used by the manual-entry fallback. */
export async function lookupTicket(code: string): Promise<CheckInResult> {
  const parsed = parseQrPayload(code);
  const ticketCode = parsed?.ticketCode ?? code.trim();

  const ticket = await queryOne<{
    attendee_name: string;
    seat_label: string | null;
    status: string;
    checked_in_at: Date | null;
    booking_code: string;
    ticket_type_name: string;
    event_title: string;
  }>(
    `SELECT t.attendee_name, t.seat_label, t.status, t.checked_in_at,
            b.booking_code, tt.name AS ticket_type_name, e.title AS event_title
       FROM tickets t
       JOIN bookings b      ON b.id = t.booking_id
       JOIN ticket_types tt ON tt.id = t.ticket_type_id
       JOIN events e        ON e.id = t.event_id
      WHERE t.ticket_code = $1`,
    [ticketCode],
  );

  if (!ticket) return { status: 'invalid', message: 'Ticket not found' };

  return {
    status: ticket.status === 'used' ? 'already_used' : ticket.status === 'valid' ? 'admitted' : 'cancelled',
    message: `Ticket is ${ticket.status}`,
    ticket: {
      ticketCode,
      attendeeName: ticket.attendee_name,
      ticketTypeName: ticket.ticket_type_name,
      seatLabel: ticket.seat_label,
      bookingCode: ticket.booking_code,
      checkedInAt: ticket.checked_in_at,
      eventTitle: ticket.event_title,
    },
  };
}

export function assertValidPayload(payload: string): void {
  if (!parseQrPayload(payload)) throw new BadRequestError('Unrecognised ticket code', 'INVALID_QR');
}
