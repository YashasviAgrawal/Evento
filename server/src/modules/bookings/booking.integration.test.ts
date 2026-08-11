/**
 * Integration tests for the booking engine, run against a real PostgreSQL.
 *
 * These cover the invariants that unit tests cannot reach — row locking,
 * transactional rollback and the not-oversold constraint — because they are
 * properties of the database, not of the TypeScript.
 *
 * Requires DATABASE_URL to point at a migrated database (npm run migrate).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { closePool, query, queryOne } from '../../db/pool';
import { rupeesToPaise } from '../../utils/money';
import { uniqueSlug } from '../../utils/ids';
import { cancelBooking, createBooking, expireStaleBookings, quoteBooking } from './booking.service';
import { checkInTicket, getTicketsForBooking } from '../tickets/ticket.service';
import { confirmBooking } from './booking.service';

/** Everything created here is namespaced so cleanup is exact. */
const TAG = `vitest-${Date.now()}`;

let adminId: string;
let organizerUserId: string;
let organizerId: string;
let eventId: string;
let scarceTierId: string;
let roomyTierId: string;
const customerIds: string[] = [];

async function createCustomer(index: number): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (full_name, email, password_hash, role, email_verified_at)
     VALUES ($1, $2, $3, 'customer', now()) RETURNING id`,
    [`Test Customer ${index}`, `${TAG}-customer-${index}@test.local`, await bcrypt.hash('Password123', 4)],
  );
  return row!.id;
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('Password123', 4);

  const admin = await queryOne<{ id: string }>(
    `INSERT INTO users (full_name, email, password_hash, role, email_verified_at)
     VALUES ('Test Admin', $1, $2, 'admin', now()) RETURNING id`,
    [`${TAG}-admin@test.local`, passwordHash],
  );
  adminId = admin!.id;

  const organizerUser = await queryOne<{ id: string }>(
    `INSERT INTO users (full_name, email, password_hash, role, email_verified_at)
     VALUES ('Test Organizer', $1, $2, 'organizer', now()) RETURNING id`,
    [`${TAG}-organizer@test.local`, passwordHash],
  );
  organizerUserId = organizerUser!.id;

  const organizer = await queryOne<{ id: string }>(
    `INSERT INTO organizers (user_id, display_name, slug, status, verified_at)
     VALUES ($1, $2, $3, 'verified', now()) RETURNING id`,
    [organizerUserId, `Test Org ${TAG}`, uniqueSlug(`test-org-${TAG}`)],
  );
  organizerId = organizer!.id;

  const city = await queryOne<{ id: string }>('SELECT id FROM cities LIMIT 1');
  const category = await queryOne<{ id: string }>('SELECT id FROM categories LIMIT 1');

  const venue = await queryOne<{ id: string }>(
    `INSERT INTO venues (organizer_id, name, address_line1, city_id)
     VALUES ($1, $2, 'Test Street 1', $3) RETURNING id`,
    [organizerId, `Test Venue ${TAG}`, city!.id],
  );

  const startsAt = new Date(Date.now() + 14 * 86_400_000);
  const event = await queryOne<{ id: string }>(
    `INSERT INTO events (organizer_id, title, slug, description, category_id, venue_id, city_id,
                         starts_at, ends_at, status, published_at)
     VALUES ($1, $2, $3, 'Integration test event', $4, $5, $6, $7, $8, 'published', now())
     RETURNING id`,
    [
      organizerId,
      `Test Event ${TAG}`,
      uniqueSlug(`test-event-${TAG}`),
      category!.id,
      venue!.id,
      city!.id,
      startsAt,
      new Date(startsAt.getTime() + 3 * 3_600_000),
    ],
  );
  eventId = event!.id;

  const scarce = await queryOne<{ id: string }>(
    `INSERT INTO ticket_types (event_id, name, kind, price_paise, quantity_total, max_per_order, display_order)
     VALUES ($1, 'Scarce', 'vip', $2, 5, 1, 0) RETURNING id`,
    [eventId, rupeesToPaise(1000)],
  );
  scarceTierId = scarce!.id;

  const roomy = await queryOne<{ id: string }>(
    `INSERT INTO ticket_types (event_id, name, kind, price_paise, quantity_total, max_per_order, display_order)
     VALUES ($1, 'Roomy', 'regular', $2, 500, 4, 1) RETURNING id`,
    [eventId, rupeesToPaise(500)],
  );
  roomyTierId = roomy!.id;

  await query(
    `UPDATE events SET total_capacity = 505, min_price_paise = $2, max_price_paise = $3 WHERE id = $1`,
    [eventId, rupeesToPaise(500), rupeesToPaise(1000)],
  );

  for (let i = 0; i < 8; i += 1) customerIds.push(await createCustomer(i));
});

afterAll(async () => {
  // Children first where no cascade covers them.
  await query('DELETE FROM events WHERE organizer_id = $1', [organizerId]).catch(() => undefined);
  await query('DELETE FROM venues WHERE organizer_id = $1', [organizerId]).catch(() => undefined);
  await query('DELETE FROM organizers WHERE id = $1', [organizerId]).catch(() => undefined);
  await query("DELETE FROM users WHERE email LIKE $1", [`${TAG}-%`]).catch(() => undefined);
  await closePool();
});

function customerDetails(index: number) {
  return {
    customerName: `Test Customer ${index}`,
    customerEmail: `${TAG}-customer-${index}@test.local`,
    customerPhone: '9900000000',
  };
}

describe('quoteBooking', () => {
  it('prices a cart without reserving any inventory', async () => {
    const before = await queryOne<{ held: number }>('SELECT quantity_held AS held FROM ticket_types WHERE id = $1', [
      roomyTierId,
    ]);

    const quote = await quoteBooking(
      { eventId, items: [{ ticketTypeId: roomyTierId, quantity: 2 }] },
      customerIds[0]!,
    );

    expect(quote.subtotalPaise).toBe(rupeesToPaise(500) * 2);
    expect(quote.totalPaise).toBeGreaterThan(quote.subtotalPaise);

    const after = await queryOne<{ held: number }>('SELECT quantity_held AS held FROM ticket_types WHERE id = $1', [
      roomyTierId,
    ]);
    expect(Number(after!.held)).toBe(Number(before!.held));
  });
});

describe('createBooking', () => {
  it('holds inventory and leaves the booking pending until payment', async () => {
    const booking = await createBooking(customerIds[1]!, {
      eventId,
      items: [{ ticketTypeId: roomyTierId, quantity: 2 }],
      ...customerDetails(1),
    });

    expect(booking.status).toBe('pending');
    expect(booking.requiresPayment).toBe(true);
    expect(booking.holdExpiresAt).toBeInstanceOf(Date);

    const tier = await queryOne<{ held: number; sold: number }>(
      'SELECT quantity_held AS held, quantity_sold AS sold FROM ticket_types WHERE id = $1',
      [roomyTierId],
    );
    expect(Number(tier!.held)).toBeGreaterThanOrEqual(2);
    expect(Number(tier!.sold)).toBe(0);
  });

  it('enforces the per-order maximum', async () => {
    await expect(
      createBooking(customerIds[2]!, {
        eventId,
        items: [{ ticketTypeId: roomyTierId, quantity: 5 }], // max is 4
        ...customerDetails(2),
      }),
    ).rejects.toThrow(/Maximum 4/);
  });

  it('treats the per-order cap as a per-customer cap across separate orders', async () => {
    const customer = customerIds[3]!;
    await createBooking(customer, {
      eventId,
      items: [{ ticketTypeId: roomyTierId, quantity: 4 }],
      ...customerDetails(3),
    });

    // A second order would put this customer over the limit.
    await expect(
      createBooking(customer, {
        eventId,
        items: [{ ticketTypeId: roomyTierId, quantity: 1 }],
        ...customerDetails(3),
      }),
    ).rejects.toThrow(/at most 4/i);
  });

  it('merges duplicate lines so the cap cannot be split across entries', async () => {
    await expect(
      createBooking(customerIds[4]!, {
        eventId,
        items: [
          { ticketTypeId: roomyTierId, quantity: 3 },
          { ticketTypeId: roomyTierId, quantity: 3 },
        ],
        ...customerDetails(4),
      }),
    ).rejects.toThrow(/Maximum 4/);
  });

  it('rejects an unknown ticket type', async () => {
    await expect(
      createBooking(customerIds[5]!, {
        eventId,
        items: [{ ticketTypeId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
        ...customerDetails(5),
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('inventory safety', () => {
  it('never oversells under concurrent booking attempts', async () => {
    // Five seats, eight simultaneous buyers, one seat each.
    const attempts = customerIds.map((customerId, index) =>
      createBooking(customerId, {
        eventId,
        items: [{ ticketTypeId: scarceTierId, quantity: 1 }],
        ...customerDetails(index),
      }).then(
        () => 'ok' as const,
        () => 'rejected' as const,
      ),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((result) => result === 'ok').length;

    expect(succeeded).toBe(5);
    expect(results.filter((r) => r === 'rejected').length).toBe(customerIds.length - 5);

    const tier = await queryOne<{ total: number; sold: number; held: number }>(
      'SELECT quantity_total AS total, quantity_sold AS sold, quantity_held AS held FROM ticket_types WHERE id = $1',
      [scarceTierId],
    );
    // The invariant the whole design exists to protect.
    expect(Number(tier!.sold) + Number(tier!.held)).toBe(Number(tier!.total));
    expect(Number(tier!.sold) + Number(tier!.held)).toBeLessThanOrEqual(Number(tier!.total));
  });

  it('refuses a booking once the tier is exhausted', async () => {
    const extra = await createCustomer(99);
    customerIds.push(extra);

    await expect(
      createBooking(extra, {
        eventId,
        items: [{ ticketTypeId: scarceTierId, quantity: 1 }],
        ...customerDetails(99),
      }),
    ).rejects.toThrow(/sold out|left/i);
  });
});

describe('confirmation, tickets and check-in', () => {
  it('converts the hold into a sale, issues tickets, and is idempotent', async () => {
    const customer = await createCustomer(200);
    customerIds.push(customer);

    const booking = await createBooking(customer, {
      eventId,
      items: [{ ticketTypeId: roomyTierId, quantity: 2 }],
      customerName: 'Ticket Holder',
      customerEmail: `${TAG}-customer-200@test.local`,
      customerPhone: '9900000000',
    });

    const before = await queryOne<{ sold: number; held: number }>(
      'SELECT quantity_sold AS sold, quantity_held AS held FROM ticket_types WHERE id = $1',
      [roomyTierId],
    );

    expect(await confirmBooking(booking.id, { method: 'mock' })).toBe(true);
    // A duplicated webhook must not double-count anything.
    expect(await confirmBooking(booking.id, { method: 'mock' })).toBe(false);

    const after = await queryOne<{ sold: number; held: number }>(
      'SELECT quantity_sold AS sold, quantity_held AS held FROM ticket_types WHERE id = $1',
      [roomyTierId],
    );

    expect(Number(after!.sold)).toBe(Number(before!.sold) + 2);
    expect(Number(after!.held)).toBe(Number(before!.held) - 2);

    const tickets = await queryOne<{ count: number }>(
      'SELECT count(*)::int AS count FROM tickets WHERE booking_id = $1',
      [booking.id],
    );
    expect(Number(tickets!.count)).toBe(2);
  });

  it('admits a valid QR exactly once', async () => {
    const customer = await createCustomer(201);
    customerIds.push(customer);

    const booking = await createBooking(customer, {
      eventId,
      items: [{ ticketTypeId: roomyTierId, quantity: 1 }],
      customerName: 'Scan Me',
      customerEmail: `${TAG}-customer-201@test.local`,
      customerPhone: '9900000000',
    });
    await confirmBooking(booking.id, { method: 'mock' });

    const tickets = await getTicketsForBooking(booking.id, { id: customer, role: 'customer' });
    expect(tickets).toHaveLength(1);

    const scanner = { id: organizerUserId, role: 'organizer', organizerId };

    const first = await checkInTicket(tickets[0]!.qrPayload, scanner, eventId);
    expect(first.status).toBe('admitted');

    const second = await checkInTicket(tickets[0]!.qrPayload, scanner, eventId);
    expect(second.status).toBe('already_used');
  });

  it('rejects a forged QR payload', async () => {
    const scanner = { id: organizerUserId, role: 'organizer', organizerId };
    const result = await checkInTicket('TKT-FORGED99.' + 'a'.repeat(32), scanner, eventId);
    expect(result.status).toBe('invalid');
  });

  it('refuses a scanner from another organizer', async () => {
    const customer = await createCustomer(202);
    customerIds.push(customer);

    const booking = await createBooking(customer, {
      eventId,
      items: [{ ticketTypeId: roomyTierId, quantity: 1 }],
      customerName: 'Wrong Scanner',
      customerEmail: `${TAG}-customer-202@test.local`,
      customerPhone: '9900000000',
    });
    await confirmBooking(booking.id, { method: 'mock' });
    const tickets = await getTicketsForBooking(booking.id, { id: customer, role: 'customer' });

    await expect(
      checkInTicket(tickets[0]!.qrPayload, {
        id: adminId,
        role: 'organizer',
        organizerId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow(/another organizer/i);
  });
});

describe('expiry and cancellation', () => {
  it('releases inventory when a hold lapses', async () => {
    const customer = await createCustomer(300);
    customerIds.push(customer);

    const booking = await createBooking(customer, {
      eventId,
      items: [{ ticketTypeId: roomyTierId, quantity: 3 }],
      customerName: 'Abandoner',
      customerEmail: `${TAG}-customer-300@test.local`,
      customerPhone: '9900000000',
    });

    const held = await queryOne<{ held: number }>('SELECT quantity_held AS held FROM ticket_types WHERE id = $1', [
      roomyTierId,
    ]);

    // Simulate the checkout window elapsing.
    await query('UPDATE bookings SET hold_expires_at = now() - INTERVAL \'1 minute\' WHERE id = $1', [booking.id]);
    const released = await expireStaleBookings();
    expect(released).toBeGreaterThanOrEqual(1);

    const after = await queryOne<{ held: number }>('SELECT quantity_held AS held FROM ticket_types WHERE id = $1', [
      roomyTierId,
    ]);
    expect(Number(after!.held)).toBe(Number(held!.held) - 3);

    const status = await queryOne<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    expect(status!.status).toBe('expired');
  });

  it('returns seats to stock and voids tickets when a confirmed booking is cancelled', async () => {
    const customer = await createCustomer(301);
    customerIds.push(customer);

    const booking = await createBooking(customer, {
      eventId,
      items: [{ ticketTypeId: roomyTierId, quantity: 2 }],
      customerName: 'Canceller',
      customerEmail: `${TAG}-customer-301@test.local`,
      customerPhone: '9900000000',
    });
    await confirmBooking(booking.id, { method: 'mock' });

    const before = await queryOne<{ sold: number }>('SELECT quantity_sold AS sold FROM ticket_types WHERE id = $1', [
      roomyTierId,
    ]);

    const result = await cancelBooking(booking.id, { id: customer, role: 'customer' }, 'Changed my mind');
    expect(result.status).toBe('cancelled');
    // Money was captured, so a refund goes to admin for review rather than
    // being returned silently.
    expect(result.refundRequested).toBe(true);

    const after = await queryOne<{ sold: number }>('SELECT quantity_sold AS sold FROM ticket_types WHERE id = $1', [
      roomyTierId,
    ]);
    expect(Number(after!.sold)).toBe(Number(before!.sold) - 2);

    const voided = await queryOne<{ count: number }>(
      "SELECT count(*)::int AS count FROM tickets WHERE booking_id = $1 AND status = 'cancelled'",
      [booking.id],
    );
    expect(Number(voided!.count)).toBe(2);
  });

  it('will not let one customer cancel another customer’s booking', async () => {
    const owner = await createCustomer(302);
    const stranger = await createCustomer(303);
    customerIds.push(owner, stranger);

    const booking = await createBooking(owner, {
      eventId,
      items: [{ ticketTypeId: roomyTierId, quantity: 1 }],
      customerName: 'Owner',
      customerEmail: `${TAG}-customer-302@test.local`,
      customerPhone: '9900000000',
    });

    await expect(
      cancelBooking(booking.id, { id: stranger, role: 'customer' }, 'Not mine'),
    ).rejects.toThrow(/another account/i);
  });
});

describe('database-level guarantees', () => {
  it('rejects an oversold row even if application logic is bypassed', async () => {
    // The CHECK constraint is the last line of defence behind the app logic.
    await expect(
      query('UPDATE ticket_types SET quantity_held = quantity_total + 1 WHERE id = $1', [scarceTierId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a negative ticket price', async () => {
    await expect(
      query(
        `INSERT INTO ticket_types (event_id, name, price_paise, quantity_total) VALUES ($1, 'Bad', -100, 10)`,
        [eventId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects an event that ends before it starts', async () => {
    const city = await queryOne<{ id: string }>('SELECT id FROM cities LIMIT 1');
    const category = await queryOne<{ id: string }>('SELECT id FROM categories LIMIT 1');
    const venue = await queryOne<{ id: string }>('SELECT id FROM venues WHERE organizer_id = $1', [organizerId]);

    await expect(
      query(
        `INSERT INTO events (organizer_id, title, slug, category_id, venue_id, city_id, starts_at, ends_at)
         VALUES ($1, 'Backwards', $2, $3, $4, $5, now() + INTERVAL '2 days', now() + INTERVAL '1 day')`,
        [organizerId, uniqueSlug(`backwards-${TAG}`), category!.id, venue!.id, city!.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
