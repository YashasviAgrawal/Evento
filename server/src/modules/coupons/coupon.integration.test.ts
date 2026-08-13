/**
 * Integration tests for organizer-created coupons.
 *
 * The rules that matter here are money rules, so they are tested against a
 * real database rather than mocked: an unapproved coupon must be inert, and an
 * organizer must never be able to discount somebody else's event.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { closePool, query, queryOne } from '../../db/pool';
import { uniqueSlug } from '../../utils/ids';
import { rupeesToPaise } from '../../utils/money';
import { evaluateCoupon, listAvailableCoupons } from './coupon.service';

const TAG = `couponspec-${Date.now()}`;

let organizerId: string;
let otherOrganizerId: string;
let eventId: string;
let customerId: string;

async function makeOrganizer(label: string): Promise<string> {
  const hash = await bcrypt.hash('Password123', 4);
  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (full_name, email, password_hash, role, email_verified_at)
     VALUES ($1, $2, $3, 'organizer', now()) RETURNING id`,
    [`Org ${label}`, `${TAG}-${label}@test.local`, hash],
  );
  const org = await queryOne<{ id: string }>(
    `INSERT INTO organizers (user_id, display_name, slug, status, verified_at)
     VALUES ($1, $2, $3, 'verified', now()) RETURNING id`,
    [user!.id, `Org ${label} ${TAG}`, uniqueSlug(`org-${label}-${TAG}`)],
  );
  return org!.id;
}

beforeAll(async () => {
  organizerId = await makeOrganizer('a');
  otherOrganizerId = await makeOrganizer('b');

  const hash = await bcrypt.hash('Password123', 4);
  const customer = await queryOne<{ id: string }>(
    `INSERT INTO users (full_name, email, password_hash, role, email_verified_at)
     VALUES ('Coupon Tester', $1, $2, 'customer', now()) RETURNING id`,
    [`${TAG}-customer@test.local`, hash],
  );
  customerId = customer!.id;

  const city = await queryOne<{ id: string }>('SELECT id FROM cities LIMIT 1');
  const category = await queryOne<{ id: string }>('SELECT id FROM categories LIMIT 1');
  const venue = await queryOne<{ id: string }>(
    `INSERT INTO venues (organizer_id, name, address_line1, city_id)
     VALUES ($1, $2, 'Test Street', $3) RETURNING id`,
    [organizerId, `Venue ${TAG}`, city!.id],
  );

  const startsAt = new Date(Date.now() + 10 * 86_400_000);
  const event = await queryOne<{ id: string }>(
    `INSERT INTO events (organizer_id, title, slug, category_id, venue_id, city_id,
                         starts_at, ends_at, status, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', now()) RETURNING id`,
    [
      organizerId,
      `Coupon Event ${TAG}`,
      uniqueSlug(`coupon-event-${TAG}`),
      category!.id,
      venue!.id,
      city!.id,
      startsAt,
      new Date(startsAt.getTime() + 7_200_000),
    ],
  );
  eventId = event!.id;
});

afterAll(async () => {
  await query('DELETE FROM coupons WHERE code LIKE $1', [`${TAG}%`]).catch(() => undefined);
  await query('DELETE FROM events WHERE organizer_id = ANY($1::uuid[])', [[organizerId, otherOrganizerId]]).catch(() => undefined);
  await query('DELETE FROM venues WHERE organizer_id = ANY($1::uuid[])', [[organizerId, otherOrganizerId]]).catch(() => undefined);
  await query('DELETE FROM organizers WHERE id = ANY($1::uuid[])', [[organizerId, otherOrganizerId]]).catch(() => undefined);
  await query('DELETE FROM users WHERE email LIKE $1', [`${TAG}-%`]).catch(() => undefined);
  await closePool();
});

async function insertCoupon(options: {
  code: string;
  approval: 'pending' | 'approved' | 'rejected';
  organizer?: string | null;
  percent?: number;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO coupons (code, type, value, min_order_paise, organizer_id, created_by_organizer,
                          approval_status, is_active)
     VALUES ($1, 'percent', $2, 0, $3, $3, $4::coupon_approval, true)
     RETURNING id`,
    [options.code, options.percent ?? 25, options.organizer ?? organizerId, options.approval],
  );
  return row!.id;
}

describe('coupon approval gate', () => {
  it('refuses a coupon that is still awaiting approval', async () => {
    await insertCoupon({ code: `${TAG}-PENDING`, approval: 'pending' });

    await expect(
      evaluateCoupon({
        code: `${TAG}-PENDING`,
        subtotalPaise: rupeesToPaise(1000),
        eventId,
        organizerId,
        userId: customerId,
      }),
    ).rejects.toMatchObject({ code: 'COUPON_NOT_FOUND' });
  });

  it('refuses a rejected coupon', async () => {
    await insertCoupon({ code: `${TAG}-REJECTED`, approval: 'rejected' });

    await expect(
      evaluateCoupon({
        code: `${TAG}-REJECTED`,
        subtotalPaise: rupeesToPaise(1000),
        eventId,
        organizerId,
        userId: customerId,
      }),
    ).rejects.toMatchObject({ code: 'COUPON_NOT_FOUND' });
  });

  it('accepts the same coupon once approved', async () => {
    const id = await insertCoupon({ code: `${TAG}-APPROVED`, approval: 'pending', percent: 50 });
    await query(`UPDATE coupons SET approval_status = 'approved' WHERE id = $1`, [id]);

    const result = await evaluateCoupon({
      code: `${TAG}-APPROVED`,
      subtotalPaise: rupeesToPaise(1000),
      eventId,
      organizerId,
      userId: customerId,
    });

    expect(result.discountPaise).toBe(rupeesToPaise(500));
  });

  it('hides unapproved coupons from the public offers list', async () => {
    const offers = await listAvailableCoupons(eventId, organizerId);
    const codes = offers.map((offer) => offer.code);

    expect(codes).not.toContain(`${TAG}-PENDING`);
    expect(codes).not.toContain(`${TAG}-REJECTED`);
    expect(codes).toContain(`${TAG}-APPROVED`);
  });
});

describe('organizer scoping', () => {
  it('rejects another organizer’s coupon on this event', async () => {
    const id = await insertCoupon({
      code: `${TAG}-OTHERORG`,
      approval: 'pending',
      organizer: otherOrganizerId,
    });
    await query(`UPDATE coupons SET approval_status = 'approved' WHERE id = $1`, [id]);

    await expect(
      evaluateCoupon({
        code: `${TAG}-OTHERORG`,
        subtotalPaise: rupeesToPaise(1000),
        eventId,
        organizerId, // this event's organizer, not the coupon's
        userId: customerId,
      }),
    ).rejects.toMatchObject({ code: 'COUPON_WRONG_ORGANIZER' });
  });

  it('will not store an organizer coupon scoped to a different organizer', async () => {
    // The database constraint is the real guarantee, independent of the API.
    await expect(
      query(
        `INSERT INTO coupons (code, type, value, min_order_paise, organizer_id, created_by_organizer,
                              approval_status, is_active)
         VALUES ($1, 'percent', 10, 0, $2, $3, 'pending', true)`,
        [`${TAG}-MISMATCH`, otherOrganizerId, organizerId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
