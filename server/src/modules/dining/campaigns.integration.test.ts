/**
 * Tixit Pass, food festivals and promoted listings over HTTP against a real
 * PostgreSQL. Requires a seeded database (the seed creates a running festival,
 * a live sponsored listing and one pass member).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { closePool, query, queryOne } from '../../db/pool';
import { liabilityBalance, PLATFORM, restaurantPayable } from '../finance/ledger';
import { DINING_TZ } from './time';
import { generateInvoices, monthBounds, previousMonth } from './invoices/invoice.service';

const app = createApp();
const API = '/api/v1';

async function signIn(email: string) {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password: 'Password123' });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.accessToken as string}` };
}

async function expectLedgerBalanced() {
  const { rows } = await query(`SELECT transaction_id FROM finance.entries GROUP BY transaction_id HAVING sum(amount_paise) <> 0`);
  expect(rows).toHaveLength(0);
}

function shiftDays(days: number): string {
  const d = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: DINING_TZ })}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const restaurant = async (name: string) => (await queryOne<{ id: string; slug: string }>('SELECT id, slug FROM dining.restaurants WHERE name = $1', [name]))!;
let admin: Record<string, string>;

beforeAll(async () => {
  admin = await signIn('admin@tixit.test');
});

afterAll(async () => {
  await closePool();
});

describe('Tixit Pass', () => {
  it('sells a pass that waives the platform fee and doubles cashback', async () => {
    const auth = await signIn('ananya@example.com');
    const ember = await restaurant('Ember & Oak');
    const before = await request(app).post(`${API}/dining/bills/quote`).set(auth).send({ restaurantId: ember.id, billTotal: 2000 });
    expect(before.body.data.convenienceFeePaise).toBeGreaterThan(0);

    const revenueBefore = await liabilityBalance(PLATFORM.membershipRevenue.code).catch(() => 0);
    const checkout = await request(app).post(`${API}/pass/checkout`).set(auth);
    expect(checkout.status).toBe(201);
    const s = checkout.body.data;
    const paid = await request(app)
      .post(`${API}/pass/verify-payment`)
      .set(auth)
      .send({ razorpayOrderId: s.orderId, razorpayPaymentId: s.mockPaymentId, razorpaySignature: s.mockSignature });
    expect(paid.body.data.membership).toMatchObject({ active: true });
    // Revenue is a credit: its "liability balance" grows by the net-of-GST price.
    expect((await liabilityBalance(PLATFORM.membershipRevenue.code)) - revenueBefore).toBe(s.amountPaise - Math.round((s.amountPaise * 18) / 118));

    const after = await request(app).post(`${API}/dining/bills/quote`).set(auth).send({ restaurantId: ember.id, billTotal: 2000 });
    expect(after.body.data.convenienceFeePaise).toBe(0);
    expect(after.body.data.feeWaivedPaise).toBe(before.body.data.convenienceFeePaise);
    expect(after.body.data.amountPayablePaise).toBe(before.body.data.amountPayablePaise - before.body.data.convenienceFeePaise);

    // Pay a bill: the pass saving is recorded and cashback is doubled.
    const created = await request(app).post(`${API}/dining/bills`).set(auth).set('Idempotency-Key', `pass-${Math.random()}`).send({ restaurantId: ember.id, billTotal: 2000 });
    const c = created.body.data;
    const bill = await request(app)
      .post(`${API}/dining/bills/${c.code}/verify-payment`)
      .set(auth)
      .send({ razorpayOrderId: c.orderId, razorpayPaymentId: c.mockPaymentId, razorpaySignature: c.mockSignature });
    const row = await queryOne<{ pass_savings_paise: number; amount_payable_paise: number }>(
      'SELECT pass_savings_paise, amount_payable_paise FROM dining.bill_payments WHERE id = $1',
      [bill.body.data.id],
    );
    expect(Number(row!.pass_savings_paise)).toBe(before.body.data.convenienceFeePaise);
    const credit = await queryOne<{ amount_paise: number }>('SELECT amount_paise FROM finance.wallet_credits WHERE source_id = $1', [bill.body.data.id]);
    // 5% × 2 of what was paid for the meal, whole rupees.
    expect(Number(credit!.amount_paise)).toBe(Math.floor((Number(row!.amount_payable_paise) * 10) / 100 / 100) * 100);

    // Renewing early stacks onto the running pass.
    const first = await queryOne<{ ends_at: Date }>(`SELECT max(ends_at) AS ends_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'ananya@example.com' AND m.status = 'active'`);
    const again = (await request(app).post(`${API}/pass/checkout`).set(auth)).body.data;
    await request(app).post(`${API}/pass/verify-payment`).set(auth).send({ razorpayOrderId: again.orderId, razorpayPaymentId: again.mockPaymentId, razorpaySignature: again.mockSignature });
    const renewed = await request(app).get(`${API}/pass`).set(auth);
    expect(new Date(renewed.body.data.membership.validUntil).getTime() - first!.ends_at.getTime()).toBe(90 * 86_400_000);
    await expectLedgerBalanced();
  });
});

describe('food festivals', () => {
  it('runs a festival deal through pricing, co-funded by Tixit, only within its dates', async () => {
    const saffron = await restaurant('Saffron Courtyard');
    const feed = await request(app).get(`${API}/dining/home`).query({ city: 'jaipur' });
    const festival = feed.body.data.festivals[0];
    expect(festival).toMatchObject({ phase: 'on' });

    const quote = await request(app).post(`${API}/dining/bills/quote`).send({ restaurantId: saffron.id, billTotal: 3000 });
    expect(quote.body.data.restaurantOffer.title).toMatch(/Winter Food Week: 35% off/);
    expect(quote.body.data.lines.find((l: { key: string }) => l.key === 'restaurant_offer').fundedBy).toBe('shared');

    // A festival that has not started yet changes nothing today.
    const created = await request(app)
      .post(`${API}/admin/dining/festivals`)
      .set(admin)
      .send({ title: `Future Fest ${Date.now()}`, citySlug: 'jaipur', startsOn: shiftDays(10), endsOn: shiftDays(12) });
    expect(created.status).toBe(201);
    const ember = await restaurant('Ember & Oak');
    await request(app)
      .post(`${API}/admin/dining/festivals/${created.body.data.id}/restaurants`)
      .set(admin)
      .send({ restaurantId: ember.id, kind: 'percent', percentOff: 90, restaurantFundedPct: 100 })
      .expect(201);
    const card = (await request(app).get(`${API}/dining/restaurants`).query({ city: 'jaipur', q: 'Ember' })).body.data[0];
    expect(card.bestOffer.label).not.toBe('Flat 90% off');
    const emberQuote = await request(app).post(`${API}/dining/bills/quote`).send({ restaurantId: ember.id, billTotal: 3000 });
    expect(emberQuote.body.data.restaurantOffer?.title ?? '').not.toMatch(/Future Fest/);

    // Draft festivals are not public; restaurants from another city are refused.
    expect((await request(app).get(`${API}/dining/festivals/${created.body.data.slug}`)).status).toBe(404);
    const delhi = await restaurant('Saravana Leaf');
    const wrong = await request(app)
      .post(`${API}/admin/dining/festivals/${created.body.data.id}/restaurants`)
      .set(admin)
      .send({ restaurantId: delhi.id, kind: 'percent', percentOff: 10 });
    expect(wrong.body.error.code).toBe('WRONG_CITY');
  });
});

describe('promoted listings', () => {
  it('charges the campaign to payouts, labels it Sponsored, ranks it first, and invoices it', async () => {
    const sponsoredSpot = await restaurant('Brew Theory');
    const list = await request(app).get(`${API}/dining/restaurants`).query({ city: 'jaipur' });
    expect(list.body.data[0]).toMatchObject({ name: 'Brew Theory', sponsored: true });
    // Explicit sorts are not bought.
    const byRating = await request(app).get(`${API}/dining/restaurants`).query({ city: 'jaipur', sort: 'rating' });
    expect(byRating.body.data[0].sponsored === true && byRating.body.data[0].rating < byRating.body.data[1].rating).toBe(false);

    const lodhi = await restaurant('Lodhi Garden House');
    const payableBefore = await liabilityBalance(restaurantPayable(lodhi.id).code).catch(() => 0);
    const created = await request(app)
      .post(`${API}/admin/dining/promotions`)
      .set(admin)
      .send({ restaurantId: lodhi.id, startsOn: shiftDays(3), endsOn: shiftDays(9), dailyPrice: 500 });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ netPaise: 7 * 50_000, gstPaise: 63_000, totalPaise: 413_000 });
    expect(payableBefore - (await liabilityBalance(restaurantPayable(lodhi.id).code))).toBe(413_000);

    const overlap = await request(app)
      .post(`${API}/admin/dining/promotions`)
      .set(admin)
      .send({ restaurantId: lodhi.id, startsOn: shiftDays(5), endsOn: shiftDays(6), dailyPrice: 500 });
    expect(overlap.body.error.code).toBe('PROMOTION_OVERLAP');

    // Not started yet: cancelling reverses the charge in full.
    await request(app).post(`${API}/admin/dining/promotions/${created.body.data.id}/cancel`).set(admin).expect(200);
    expect(await liabilityBalance(restaurantPayable(lodhi.id).code)).toBe(payableBefore);

    // A running campaign cannot be cancelled.
    const live = await queryOne<{ id: string }>(`SELECT id FROM dining.promotions WHERE restaurant_id = $1 AND status = 'active'`, [sponsoredSpot.id]);
    const refused = await request(app).post(`${API}/admin/dining/promotions/${live!.id}/cancel`).set(admin);
    expect(refused.body.error.code).toBe('PROMOTION_STARTED');

    // Campaigns are invoiced, as advertising, in the month they start.
    const startMonth = previousMonth();
    const { start } = monthBounds(startMonth);
    await query(
      `INSERT INTO dining.promotions (restaurant_id, starts_on, ends_on, daily_price_paise, net_paise, gst_paise)
       VALUES ($1, $2::date + 3, $2::date + 5, 50000, 150000, 27000)`,
      [sponsoredSpot.id, start],
    );
    await query('DELETE FROM finance.invoices WHERE restaurant_id = $1 AND period_start = $2', [sponsoredSpot.id, start]);
    await generateInvoices(startMonth, { restaurantId: sponsoredSpot.id });
    const invoice = await queryOne<{ lines: Array<{ sac?: string; taxablePaise: number }> }>(
      'SELECT lines FROM finance.invoices WHERE restaurant_id = $1 AND period_start = $2',
      [sponsoredSpot.id, start],
    );
    expect(invoice!.lines.some((line) => line.sac === '998365')).toBe(true);
    await expectLedgerBalanced();
  });
});
