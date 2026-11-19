/**
 * End-to-end over HTTP against a real PostgreSQL: single sign-on cookies,
 * reservations, Pay Bill (mock gateway, real signature verification), the
 * partner verification flow, and the ledger. Requires a migrated and seeded
 * database (`npm run migrate && npm run seed`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { closePool, query, queryOne } from '../../db/pool';
import { liabilityBalance, restaurantPayable } from '../finance/ledger';

const app = createApp();
const CLIENT = { 'x-tixit-client': 'web' };

function cookieValue(res: request.Response, name: string): string | null {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const hit = raw?.find((cookie) => cookie.startsWith(`${name}=`) && !cookie.startsWith(`${name}=;`));
  return hit ? hit.split(';')[0]!.slice(name.length + 1) : null;
}

async function signIn(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123' });
  expect(res.status).toBe(200);
  return { access: res.body.data.accessToken as string, refresh: cookieValue(res, 'tx_rt')!, res };
}

let restaurantId: string;
let restaurantSlug: string;

beforeAll(async () => {
  const row = await queryOne<{ id: string; slug: string }>(
    `SELECT r.id, r.slug FROM dining.restaurants r
       JOIN dining.restaurant_members m ON m.restaurant_id = r.id
       JOIN users u ON u.id = m.user_id
      WHERE u.email = 'partner@tixit.test' AND r.name = 'Ember & Oak'`,
  );
  if (!row) throw new Error('Run `npm run seed` before the dining integration suite');
  restaurantId = row.id;
  restaurantSlug = row.slug;
});

afterAll(async () => {
  await closePool();
});

describe('single sign-on session', () => {
  it('sets an HttpOnly refresh cookie and a domain-wide hint, and never returns the refresh token to browsers', async () => {
    const { res } = await signIn('customer@tixit.test');
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookies).toMatch(/tx_rt=[^;]+;.*HttpOnly/);
    expect(cookies).toMatch(/tx_rt=[^;]+;.*SameSite=Lax/);
    expect(cookies).toMatch(/tx_session=1;/);
    expect(res.body.data.refreshToken).toBeUndefined();
  });

  it('boots a second app from the cookie alone (refresh returns the user)', async () => {
    const { refresh } = await signIn('customer@tixit.test');
    const res = await request(app).post('/api/v1/auth/refresh').set(CLIENT).set('Cookie', `tx_rt=${refresh}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('customer@tixit.test');
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('rejects a cookie refresh without the client header (CSRF guard)', async () => {
    const { refresh } = await signIn('customer@tixit.test');
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `tx_rt=${refresh}`).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CSRF_HEADER_MISSING');
  });

  it('survives two apps refreshing the same token at once (grace window)', async () => {
    const { refresh } = await signIn('customer@tixit.test');
    const [a, b] = await Promise.all([
      request(app).post('/api/v1/auth/refresh').set(CLIENT).set('Cookie', `tx_rt=${refresh}`).send({}),
      request(app).post('/api/v1/auth/refresh').set(CLIENT).set('Cookie', `tx_rt=${refresh}`).send({}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it('revokes the whole family when a rotated token is replayed after the grace window', async () => {
    const { refresh } = await signIn('customer@tixit.test');
    const rotated = await request(app).post('/api/v1/auth/refresh').set(CLIENT).set('Cookie', `tx_rt=${refresh}`).send({});
    const successor = cookieValue(rotated, 'tx_rt')!;
    await query(`UPDATE refresh_tokens SET revoked_at = now() - interval '5 minutes' WHERE revoke_reason = 'rotated' AND token_hash = encode(sha256($1::bytea), 'hex')`, [refresh]);

    const replay = await request(app).post('/api/v1/auth/refresh').set(CLIENT).set('Cookie', `tx_rt=${refresh}`).send({});
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSED');

    const victim = await request(app).post('/api/v1/auth/refresh').set(CLIENT).set('Cookie', `tx_rt=${successor}`).send({});
    expect(victim.status).toBe(401);
  });

  it('signs out every app by revoking the family on logout', async () => {
    const { refresh } = await signIn('customer@tixit.test');
    const out = await request(app).post('/api/v1/auth/logout').set(CLIENT).set('Cookie', `tx_rt=${refresh}`).send({});
    expect(out.status).toBe(200);
    const after = await request(app).post('/api/v1/auth/refresh').set(CLIENT).set('Cookie', `tx_rt=${refresh}`).send({});
    expect(after.status).toBe(401);
  });
});

describe('discovery', () => {
  it('serves the home feed and restaurant page', async () => {
    const home = await request(app).get('/api/v1/dining/home?city=jaipur');
    expect(home.status).toBe(200);
    expect(home.body.data.restaurantCount).toBeGreaterThan(5);
    expect(home.body.data.collections.length).toBeGreaterThan(0);

    const page = await request(app).get(`/api/v1/dining/restaurants/${restaurantSlug}`);
    expect(page.status).toBe(200);
    expect(page.body.data.offers.length).toBeGreaterThan(0);
  });

  it('searches by cuisine text and sorts by offer', async () => {
    const res = await request(app).get('/api/v1/dining/restaurants?city=jaipur&q=rajasthani&sort=offer');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta.total).toBeGreaterThan(0);
  });
});

describe('reservation → Pay Bill → verification → ledger', () => {
  it('runs the whole dine-in loop and keeps the ledger balanced', async () => {
    const diner = await signIn('diya@example.com');
    const auth = { Authorization: `Bearer ${diner.access}` };

    // Book the first open slot tomorrow (today may already be over).
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const slots = await request(app).get(`/api/v1/dining/restaurants/${restaurantSlug}/slots?date=${tomorrow}&party=2`);
    const slot = slots.body.data.slots.find((s: { available: boolean }) => s.available);
    expect(slot).toBeTruthy();

    const booked = await request(app).post('/api/v1/dining/reservations').set(auth).send({ slotId: slot.id, partySize: 2 });
    expect(booked.status).toBe(201);
    expect(booked.body.data.status).toBe('confirmed');
    const again = await request(app).post('/api/v1/dining/reservations').set(auth).send({ slotId: slot.id, partySize: 2 });
    expect(again.body.error.code).toBe('ALREADY_BOOKED');
    const cancelled = await request(app).post(`/api/v1/dining/reservations/${booked.body.data.code}/cancel`).set(auth).send({});
    expect(cancelled.body.data.status).toBe('cancelled_by_diner');

    // Walk-in Pay Bill.
    const body = { restaurantId, billTotal: 2400, nonDiscountable: 400, keepServiceCharge: false, tip: 0, couponCode: 'TIXITDINE' };
    const quote = await request(app).post('/api/v1/dining/bills/quote').send(body);
    expect(quote.status).toBe(200);
    expect(quote.body.data.coupon.discountPaise).toBe(10_000);

    const key = `test-${Date.now()}`;
    const created = await request(app).post('/api/v1/dining/bills').set(auth).set('Idempotency-Key', key).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.amountPaise).toBe(quote.body.data.amountPayablePaise);
    const retry = await request(app).post('/api/v1/dining/bills').set(auth).set('Idempotency-Key', key).send(body);
    expect(retry.body.data.code).toBe(created.body.data.code);

    const balanceBefore = await liabilityBalance(restaurantPayable(restaurantId).code);
    const session = created.body.data;
    const forged = await request(app)
      .post(`/api/v1/dining/bills/${session.code}/verify-payment`)
      .set(auth)
      .send({ razorpayOrderId: session.orderId, razorpayPaymentId: session.mockPaymentId, razorpaySignature: 'f'.repeat(64) });
    expect(forged.status).toBe(402);

    const paid = await request(app)
      .post(`/api/v1/dining/bills/${session.code}/verify-payment`)
      .set(auth)
      .send({ razorpayOrderId: session.orderId, razorpayPaymentId: session.mockPaymentId, razorpaySignature: session.mockSignature });
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('paid');
    expect(paid.body.data.pass.code).toMatch(/^\d{6}$/);

    // The ledger moved by exactly the restaurant's payout, and every transaction balances.
    const bill = await queryOne<{ restaurant_payout_paise: number }>('SELECT restaurant_payout_paise FROM dining.bill_payments WHERE code = $1', [session.code]);
    const balanceAfter = await liabilityBalance(restaurantPayable(restaurantId).code);
    expect(balanceAfter - balanceBefore).toBe(Number(bill!.restaurant_payout_paise));
    const unbalanced = await query(`SELECT transaction_id FROM finance.entries GROUP BY transaction_id HAVING sum(amount_paise) <> 0`);
    expect(unbalanced.rows).toHaveLength(0);

    // A diner without membership cannot see the partner console…
    const nosy = await request(app).get(`/api/v1/partner/r/${restaurantId}/live`).set(auth);
    expect(nosy.status).toBe(404);

    // …the cashier can, sees the same rotating code, and verifies it.
    const cashier = await signIn('cashier@tixit.test');
    const staff = { Authorization: `Bearer ${cashier.access}` };
    const live = await request(app).get(`/api/v1/partner/r/${restaurantId}/live`).set(staff);
    expect(live.status).toBe(200);
    const card = live.body.data.bills.find((b: { code: string }) => b.code === session.code);
    expect(card.passCode).toBe(paid.body.data.pass.code);

    const offersDenied = await request(app).get(`/api/v1/partner/r/${restaurantId}/offers`).set(staff);
    expect(offersDenied.status).toBe(403);

    const verified = await request(app)
      .post(`/api/v1/partner/r/${restaurantId}/bills/${session.code}/verify`)
      .set(staff)
      .send({ result: 'match' });
    expect(verified.body.data.status).toBe('verified');
    const twice = await request(app)
      .post(`/api/v1/partner/r/${restaurantId}/bills/${session.code}/verify`)
      .set(staff)
      .send({ result: 'match' });
    expect(twice.status).toBe(409);

    // One review per paid visit.
    const review = await request(app).post('/api/v1/dining/reviews').set(auth).send({ billCode: session.code, rating: 5, body: 'Seamless.' });
    expect(review.status).toBe(201);
    const dup = await request(app).post('/api/v1/dining/reviews').set(auth).send({ billCode: session.code, rating: 4 });
    expect(dup.status).toBe(409);
  });
});

describe('partner availability, admin onboarding and notifications', () => {
  it('lets a manager reshape availability without disturbing booked tables', async () => {
    const owner = await signIn('partner@tixit.test');
    const auth = { Authorization: `Bearer ${owner.access}` };
    const before = await request(app).get(`/api/v1/partner/r/${restaurantId}/availability`).set(auth);
    expect(before.status).toBe(200);
    expect(before.body.data.rules.length).toBeGreaterThan(0);

    // A diner holds a table the day after tomorrow.
    const diner = await signIn('kabir@example.com');
    const day = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const slots = await request(app).get(`/api/v1/dining/restaurants/${restaurantSlug}/slots?date=${day}&party=4`);
    const slot = slots.body.data.slots.find((s: { available: boolean }) => s.available);
    const booked = await request(app)
      .post('/api/v1/dining/reservations')
      .set({ Authorization: `Bearer ${diner.access}` })
      .send({ slotId: slot.id, partySize: 4 });
    expect(booked.status).toBe(201);

    // Overlapping windows are rejected; a valid replacement is accepted.
    const overlap = await request(app)
      .put(`/api/v1/partner/r/${restaurantId}/availability/rules`)
      .set(auth)
      .send({ rules: [0, 1].map(() => ({ weekday: 1, startTime: '19:00', endTime: '22:00', coversPerSlot: 10 })) });
    expect(overlap.body.error.code).toBe('RULES_OVERLAP');

    const rules = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '18:00', endTime: '22:00', slotMinutes: 60, coversPerSlot: 2, maxParty: 6 }));
    const saved = await request(app).put(`/api/v1/partner/r/${restaurantId}/availability/rules`).set(auth).send({ rules });
    expect(saved.status).toBe(200);
    expect(saved.body.data.rules).toHaveLength(7);

    // The booked slot survives with room for the covers already in it.
    const kept = await queryOne<{ capacity: number; booked: number }>('SELECT capacity, booked FROM dining.slots WHERE id = $1', [slot.id]);
    expect(kept!.booked).toBe(4);
    expect(kept!.capacity).toBeGreaterThanOrEqual(4);

    // Slots the new hourly rules no longer produce take no new bookings.
    const orphans = await queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM dining.slots
        WHERE restaurant_id = $1 AND starts_at > now() AND capacity - booked - held > 0
          AND extract(minute FROM starts_at AT TIME ZONE 'Asia/Kolkata') <> 0`,
      [restaurantId],
    );
    expect(orphans!.count).toBe(0);

    // Closing the date blocks every slot and reports the bookings to call.
    const closed = await request(app).post(`/api/v1/partner/r/${restaurantId}/availability/closures`).set(auth).send({ date: day, closed: true });
    expect(closed.body.data.existingBookings).toBe(1);
    const after = await request(app).get(`/api/v1/dining/restaurants/${restaurantSlug}/slots?date=${day}&party=2`);
    expect(after.body.data.slots.every((s: { available: boolean }) => !s.available)).toBe(true);
    await request(app).post(`/api/v1/partner/r/${restaurantId}/availability/closures`).set(auth).send({ date: day, closed: false });

    // A cashier may not touch availability.
    const cashier = await signIn('cashier@tixit.test');
    const denied = await request(app).get(`/api/v1/partner/r/${restaurantId}/availability`).set({ Authorization: `Bearer ${cashier.access}` });
    expect(denied.status).toBe(403);

    // The diner was emailed about the booking (console transport records it).
    await new Promise((resolve) => setTimeout(resolve, 300));
    const mail = await queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE u.email = 'kabir@example.com' AND n.template = 'dining_reservation'`,
    );
    expect(mail!.count).toBeGreaterThan(0);
  });

  it('gives admins commercials, settlements and a last-owner guard', async () => {
    const admin = await signIn('admin@tixit.test');
    const auth = { Authorization: `Bearer ${admin.access}` };

    const detail = await request(app).get(`/api/v1/admin/dining/restaurants/${restaurantId}`).set(auth);
    expect(detail.status).toBe(200);
    const owed = detail.body.data.payableBalancePaise as number;
    expect(owed).toBeGreaterThan(0);

    const commercials = await request(app)
      .patch(`/api/v1/admin/dining/restaurants/${restaurantId}/commercials`)
      .set(auth)
      .send({ commissionPercent: 7.5 });
    expect(commercials.body.data.commissionPercent).toBe(7.5);

    const tooMuch = await request(app)
      .post(`/api/v1/admin/dining/restaurants/${restaurantId}/settlements`)
      .set(auth)
      .send({ amount: owed / 100 + 1 });
    expect(tooMuch.body.error.code).toBe('EXCEEDS_BALANCE');
    const settled = await request(app)
      .post(`/api/v1/admin/dining/restaurants/${restaurantId}/settlements`)
      .set(auth)
      .send({ amount: 100, utr: 'UTR123' });
    expect(settled.status).toBe(201);
    const afterSettle = await request(app).get(`/api/v1/admin/dining/restaurants/${restaurantId}`).set(auth);
    expect(afterSettle.body.data.payableBalancePaise).toBe(owed - 10_000);

    const owner = detail.body.data.members.find((m: { role: string }) => m.role === 'owner');
    const lastOwner = await request(app).delete(`/api/v1/admin/dining/restaurants/${restaurantId}/members/${owner.userId}`).set(auth);
    expect(lastOwner.body.error.code).toBe('LAST_OWNER');

    const diner = await signIn('diya@example.com');
    const forbidden = await request(app).get(`/api/v1/admin/dining/restaurants/${restaurantId}`).set({ Authorization: `Bearer ${diner.access}` });
    expect(forbidden.status).toBe(403);
  });
});
