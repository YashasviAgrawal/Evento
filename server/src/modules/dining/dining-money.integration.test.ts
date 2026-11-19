/**
 * Phase-3 money paths over HTTP against a real PostgreSQL: wallet spend and
 * cashback, bank offers, table deposits (credit, refund, forfeit), phone
 * sign-in, Razorpay Route payouts and their reversal. After every scenario
 * the double-entry ledger must still balance.
 *
 * Requires a migrated and seeded database (`npm run migrate && npm run seed`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { env } from '../../config/env';
import { closePool, query, queryOne } from '../../db/pool';
import { drainOutbox } from '../platform/outbox';
import { availableBalance, releaseCashback } from '../finance/wallet';
import { liabilityBalance, PLATFORM, restaurantPayable } from '../finance/ledger';
import { cancelAbandonedBills } from './bills/bill.service';
import { onTransferEvent } from './admin/dining-admin.service';

const app = createApp();

async function signIn(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123' });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.accessToken as string}` };
}

async function expectLedgerBalanced() {
  const { rows } = await query(`SELECT transaction_id FROM finance.entries GROUP BY transaction_id HAVING sum(amount_paise) <> 0`);
  expect(rows).toHaveLength(0);
}

/** Create a bill and pay it through the mock gateway, returning the bill view. */
async function payBill(auth: Record<string, string>, body: Record<string, unknown>) {
  const created = await request(app).post('/api/v1/dining/bills').set(auth).set('Idempotency-Key', `t-${Math.random()}`).send(body);
  expect(created.status).toBe(201);
  const s = created.body.data;
  const paid = await request(app)
    .post(`/api/v1/dining/bills/${s.code}/verify-payment`)
    .set(auth)
    .send({ razorpayOrderId: s.orderId, razorpayPaymentId: s.mockPaymentId, razorpaySignature: s.mockSignature });
  expect(paid.status).toBe(200);
  return { checkout: s, bill: paid.body.data };
}

let ember: { id: string; slug: string };
let terrace: { id: string; slug: string };
let hdfcOfferId: string;

beforeAll(async () => {
  const rows = await query<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM dining.restaurants WHERE name IN ('Ember & Oak', 'Terrace at Nahargarh View')`,
  );
  if (rows.rows.length < 2) throw new Error('Run `npm run seed` before this suite');
  ember = rows.rows.find((r) => r.name === 'Ember & Oak')!;
  terrace = rows.rows.find((r) => r.name === 'Terrace at Nahargarh View')!;
  hdfcOfferId = (await queryOne<{ id: string }>(`SELECT id FROM dining.offers WHERE bank_name = 'HDFC Bank'`))!.id;
});

afterAll(async () => {
  await drainOutbox();
  await closePool();
});

describe('wallet, bank offers and cashback', () => {
  it('spends the wallet and a bank offer, posts the bank receivable, and accrues cashback', async () => {
    const auth = await signIn('diya@example.com');
    const diya = (await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = 'diya@example.com'`))!.id;
    const walletBefore = await availableBalance(diya);
    expect(walletBefore).toBe(15_000);

    const body = { restaurantId: ember.id, billTotal: 3000, useWallet: true, bankOfferId: hdfcOfferId };
    const quote = await request(app).post('/api/v1/dining/bills/quote').set(auth).send(body);
    expect(quote.body.data.walletUsedPaise).toBe(15_000);
    expect(quote.body.data.bankOffer.discountPaise).toBeGreaterThan(0);
    expect(quote.body.data.bankOptions.length).toBeGreaterThanOrEqual(2);

    const bankBefore = await liabilityBalance('bank:hdfc-bank:receivable').catch(() => 0);
    const { bill } = await payBill(auth, body);
    expect(bill.pricing.walletUsedPaise).toBe(15_000);
    expect(await availableBalance(diya)).toBe(0);

    // Banks owe us their share (an asset, so its "liability balance" goes negative).
    const bankAfter = await liabilityBalance('bank:hdfc-bank:receivable');
    expect(bankBefore - bankAfter).toBe(bill.pricing.bankOffer.discountPaise);

    const credit = await queryOne<{ status: string; amount_paise: number }>(
      `SELECT status, amount_paise FROM finance.wallet_credits WHERE source_id = $1`,
      [bill.id],
    );
    expect(credit!.status).toBe('pending');
    expect(Number(credit!.amount_paise)).toBeGreaterThan(0);
    await expectLedgerBalanced();

    // Verified at the table + wait over → spendable; posted as an expense.
    const staff = await signIn('cashier@tixit.test');
    await request(app).post(`/api/v1/partner/r/${ember.id}/bills/${bill.code}/verify`).set(staff).send({ result: 'match' });
    await query(`UPDATE finance.wallet_credits SET available_at = now() - interval '1 minute' WHERE source_id = $1`, [bill.id]);
    const before = await liabilityBalance(PLATFORM.walletLiability.code);
    const released = await releaseCashback();
    expect(released.released).toBeGreaterThanOrEqual(1);
    expect(await availableBalance(diya)).toBe(Number(credit!.amount_paise));
    expect((await liabilityBalance(PLATFORM.walletLiability.code)) - before).toBe(Number(credit!.amount_paise));

    const wallet = await request(app).get('/api/v1/wallet').set(auth);
    expect(wallet.body.data.availablePaise).toBe(Number(credit!.amount_paise));
    await expectLedgerBalanced();
  });

  it('claws back cashback on a disputed bill and returns wallet holds on abandoned bills', async () => {
    const auth = await signIn('meera@example.com');
    const meera = (await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = 'meera@example.com'`))!.id;
    const { bill } = await payBill(auth, { restaurantId: ember.id, billTotal: 2000 });
    const staff = await signIn('cashier@tixit.test');
    await request(app).post(`/api/v1/partner/r/${ember.id}/bills/${bill.code}/verify`).set(staff).send({ result: 'mismatch', reason: 'test' });
    await query(`UPDATE finance.wallet_credits SET available_at = now() - interval '1 minute' WHERE source_id = $1`, [bill.id]);
    await releaseCashback();
    const credit = await queryOne<{ status: string }>(`SELECT status FROM finance.wallet_credits WHERE source_id = $1`, [bill.id]);
    expect(credit!.status).toBe('clawed_back');

    // Give Meera ₹100 to spend, open a bill with it, then abandon the bill.
    await query(
      `INSERT INTO finance.wallet_credits (user_id, source_type, source_id, amount_paise, remaining_paise, status, available_at, expires_at)
       VALUES ($1, 'adjustment', gen_random_uuid(), 10000, 10000, 'available', now(), now() + interval '30 days')`,
      [meera],
    );
    const created = await request(app)
      .post('/api/v1/dining/bills')
      .set(auth)
      .set('Idempotency-Key', `abandon-${Date.now()}`)
      .send({ restaurantId: ember.id, billTotal: 1500, useWallet: true });
    expect(created.status).toBe(201);
    expect(await availableBalance(meera)).toBe(0);
    await query(`UPDATE dining.bill_payments SET created_at = now() - interval '2 hours' WHERE code = $1`, [created.body.data.code]);
    await cancelAbandonedBills();
    expect(await availableBalance(meera)).toBe(10_000);
  });
});

describe('table deposits', () => {
  /**
   * Book a table `daysAhead` days out. `0` means "a table later today": the
   * booking is made for tomorrow and moved to `minutesFromNow`, so the test
   * does not depend on what time of day it runs.
   */
  async function bookTerrace(auth: Record<string, string>, daysAhead: number, minutesFromNow = 0) {
    const booking = await bookTerraceOn(auth, Math.max(1, daysAhead));
    if (daysAhead === 0) {
      await query(`UPDATE dining.reservations SET starts_at = now() + make_interval(mins => $2) WHERE code = $1`, [
        booking.reservation.code,
        minutesFromNow,
      ]);
    }
    return booking;
  }

  async function bookTerraceOn(auth: Record<string, string>, daysAhead: number) {
    const day = new Date(Date.now() + daysAhead * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const slots = await request(app).get(`/api/v1/dining/restaurants/${terrace.slug}/slots?date=${day}&party=2`);
    const slot = slots.body.data.slots.find((s: { available: boolean }) => s.available);
    const booked = await request(app).post('/api/v1/dining/reservations').set(auth).send({ slotId: slot.id, partySize: 2 });
    expect(booked.status).toBe(201);
    return { reservation: booked.body.data, slotId: slot.id as string };
  }

  async function payDeposit(auth: Record<string, string>, code: string) {
    const order = await request(app).post(`/api/v1/dining/reservations/${code}/deposit`).set(auth).send({});
    expect(order.status).toBe(200);
    const s = order.body.data;
    const paid = await request(app)
      .post(`/api/v1/dining/reservations/${code}/deposit/verify`)
      .set(auth)
      .send({ razorpayOrderId: s.orderId, razorpayPaymentId: s.mockPaymentId, razorpaySignature: s.mockSignature });
    expect(paid.status).toBe(200);
    return paid.body.data;
  }

  it('holds covers until the deposit is paid, then credits it on the bill', async () => {
    const auth = await signIn('arjun@example.com');
    const { reservation, slotId } = await bookTerrace(auth, 0);
    expect(reservation.status).toBe('pending_payment');
    expect(reservation.deposit.amountPaise).toBe(50_000);
    const held = await queryOne<{ held: number; booked: number }>('SELECT held, booked FROM dining.slots WHERE id = $1', [slotId]);
    expect(held!.held).toBeGreaterThanOrEqual(2);

    const confirmed = await payDeposit(auth, reservation.code);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.deposit.status).toBe('paid');

    const { bill } = await payBill(auth, { restaurantId: terrace.id, billTotal: 2600, reservationCode: reservation.code });
    expect(bill.pricing.coverCreditPaise).toBe(50_000);
    const after = await queryOne<{ cover_status: string; status: string }>(
      'SELECT cover_status, status FROM dining.reservations WHERE code = $1',
      [reservation.code],
    );
    expect(after).toEqual({ cover_status: 'credited', status: 'completed' });
    await expectLedgerBalanced();
  });

  it('refunds a deposit cancelled 24 h ahead and forfeits one cancelled late', async () => {
    const auth = await signIn('ananya@example.com');
    const early = await bookTerrace(auth, 3);
    await payDeposit(auth, early.reservation.code);
    const cancelled = await request(app).post(`/api/v1/dining/reservations/${early.reservation.code}/cancel`).set(auth).send({});
    expect(cancelled.body.data.status).toBe('cancelled_by_diner');
    await drainOutbox();
    const refunded = await queryOne<{ cover_status: string }>('SELECT cover_status FROM dining.reservations WHERE code = $1', [early.reservation.code]);
    expect(refunded!.cover_status).toBe('refunded');

    const late = await bookTerrace(auth, 0, 120);
    await payDeposit(auth, late.reservation.code);
    const owedBefore = await liabilityBalance(restaurantPayable(terrace.id).code);
    await request(app).post(`/api/v1/dining/reservations/${late.reservation.code}/cancel`).set(auth).send({});
    const forfeited = await queryOne<{ cover_status: string }>('SELECT cover_status FROM dining.reservations WHERE code = $1', [late.reservation.code]);
    expect(forfeited!.cover_status).toBe('forfeited');
    expect(await liabilityBalance(restaurantPayable(terrace.id).code)).toBeGreaterThan(owedBefore);
    await expectLedgerBalanced();
  });
});

describe('phone sign-in', () => {
  it('texts a code to an account’s mobile and signs in with the shared session', async () => {
    const requested = await request(app).post('/api/v1/auth/phone/otp/request').send({ phone: '+91 99000 00002' });
    expect(requested.status).toBe(200);
    const code = requested.body.data.devOtp as string;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await request(app).post('/api/v1/auth/phone/otp/verify').send({ phone: '9900000002', code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('OTP_INVALID');

    const verified = await request(app).post('/api/v1/auth/phone/otp/verify').send({ phone: '9900000002', code });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.email).toBe('diya@example.com');
    expect((verified.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/tx_rt=/);

    const unknown = await request(app).post('/api/v1/auth/phone/otp/request').send({ phone: '9123456789' });
    expect(unknown.body.error.code).toBe('PHONE_NOT_REGISTERED');
  });
});

describe('payouts and platform offers', () => {
  it('pays through Razorpay Route when linked, and reverses a failed transfer', async () => {
    const admin = await signIn('admin@tixit.test');
    const manual = await request(app).post(`/api/v1/admin/dining/restaurants/${terrace.id}/settlements`).set(admin).send({ amount: 10 });
    expect(manual.body.error.code).toBe('UTR_REQUIRED');

    await request(app).patch(`/api/v1/admin/dining/restaurants/${terrace.id}/commercials`).set(admin).send({ razorpayAccountId: 'acc_TestTerrace01' });
    const original = env.razorpay.routeEnabled;
    (env.razorpay as { routeEnabled: boolean }).routeEnabled = true;
    try {
      const owed = await liabilityBalance(restaurantPayable(terrace.id).code);
      const paid = await request(app).post(`/api/v1/admin/dining/restaurants/${terrace.id}/settlements`).set(admin).send({ amount: 50 });
      expect(paid.status).toBe(201);
      expect(paid.body.data.method).toBe('route');
      expect(paid.body.data.transferId).toMatch(/^trf_/);
      expect(await liabilityBalance(restaurantPayable(terrace.id).code)).toBe(owed - 5000);

      await onTransferEvent(paid.body.data.transferId, 'failed', 'Account not activated');
      expect(await liabilityBalance(restaurantPayable(terrace.id).code)).toBe(owed);
      const settlement = await queryOne<{ status: string }>('SELECT status FROM finance.settlements WHERE razorpay_transfer_id = $1', [
        paid.body.data.transferId,
      ]);
      expect(settlement!.status).toBe('failed');
    } finally {
      (env.razorpay as { routeEnabled: boolean }).routeEnabled = original;
    }
    await expectLedgerBalanced();
  });

  it('lets admins publish platform codes and bank offers, with unique codes', async () => {
    const admin = await signIn('admin@tixit.test');
    const code = `T${Date.now().toString(36).toUpperCase()}`;
    const created = await request(app)
      .post('/api/v1/admin/dining/offers')
      .set(admin)
      .send({ owner: 'platform', code, title: 'Test ₹50 off', kind: 'flat', flatOff: 50, perUserLimit: 1 });
    expect(created.status).toBe(201);
    const dup = await request(app)
      .post('/api/v1/admin/dining/offers')
      .set(admin)
      .send({ owner: 'platform', code, title: 'Again', kind: 'flat', flatOff: 50 });
    expect(dup.body.error.code).toBe('CODE_TAKEN');
    const bank = await request(app)
      .post('/api/v1/admin/dining/offers')
      .set(admin)
      .send({ owner: 'bank', bankName: 'Axis Bank', paymentMethods: ['credit_card'], title: 'Axis cards 5%', kind: 'percent', percentOff: 5 });
    expect(bank.status).toBe(201);
    const list = await request(app).get('/api/v1/admin/dining/offers').set(admin);
    expect(list.body.data.some((o: { code: string | null }) => o.code === code)).toBe(true);
    await request(app).patch(`/api/v1/admin/dining/offers/${bank.body.data.id}`).set(admin).send({ status: 'archived' });
  });
});
