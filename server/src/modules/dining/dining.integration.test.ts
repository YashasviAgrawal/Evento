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
