/**
 * Split the bill, end to end over HTTP against a real PostgreSQL: shares paid
 * by different people, "cover the rest", expiry with refunds, a late payment
 * for a share that is no longer open, and the ledger balancing throughout.
 *
 * Requires a migrated and seeded database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { closePool, query, queryOne } from '../../db/pool';
import { drainOutbox } from '../platform/outbox';
import { liabilityBalance, PLATFORM } from '../finance/ledger';
import { expireSplits } from './bills/split.service';
import { splitAmounts } from './bills/split-shares';

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

async function startSplit(auth: Record<string, string>, people: number, billTotal = 4000) {
  const res = await request(app)
    .post(`${API}/dining/bills`)
    .set(auth)
    .set('Idempotency-Key', `split-${Math.random()}`)
    .send({ restaurantId: restaurantId, billTotal, splitInto: people });
  expect(res.status).toBe(201);
  expect(res.body.data).toMatchObject({ split: true });
  const code = res.body.data.code as string;
  const split = await request(app).get(`${API}/dining/bills/${code}/split`).set(auth);
  return { code, split: split.body.data as { shares: Array<{ token: string; amountPaise: number; status: string }>; totalPaise: number } };
}

async function payShare(auth: Record<string, string>, token: string) {
  const checkout = await request(app).post(`${API}/dining/splits/${token}/checkout`).set(auth);
  expect(checkout.status).toBe(201);
  const s = checkout.body.data;
  const paid = await request(app)
    .post(`${API}/dining/splits/${token}/verify-payment`)
    .set(auth)
    .send({ razorpayOrderId: s.orderId, razorpayPaymentId: s.mockPaymentId, razorpaySignature: s.mockSignature });
  expect(paid.status).toBe(200);
  return { checkout: s, share: paid.body.data };
}

let restaurantId: string;
let host: Record<string, string>;
let friend: Record<string, string>;
let friend2: Record<string, string>;

beforeAll(async () => {
  restaurantId = (await queryOne<{ id: string }>(`SELECT id FROM dining.restaurants WHERE name = 'Ember & Oak'`))!.id;
  host = await signIn('kabir@example.com');
  friend = await signIn('arjun@example.com');
  friend2 = await signIn('meera@example.com');
});

afterAll(async () => {
  await drainOutbox();
  await closePool();
});

describe('split amounts', () => {
  it('splits into equal shares with the odd paise on the host', () => {
    expect(splitAmounts(100_001, 3)).toEqual([33_335, 33_333, 33_333]);
    expect(splitAmounts(90_000, 3).reduce((a, b) => a + b, 0)).toBe(90_000);
  });
});

describe('split the bill', () => {
  it('settles the bill only when the last share lands, with cashback for each payer', async () => {
    const collectionsBefore = await liabilityBalance(PLATFORM.splitCollections.code).catch(() => 0);
    const { code, split } = await startSplit(host, 3);
    expect(split.shares).toHaveLength(3);
    expect(split.shares.reduce((sum, share) => sum + share.amountPaise, 0)).toBe(split.totalPaise);

    // A friend opens the link without signing in and sees their amount.
    const preview = await request(app).get(`${API}/dining/splits/${split.shares[1]!.token}`);
    expect(preview.body.data).toMatchObject({ shareNo: 2, status: 'open', paidCount: 0, shareCount: 3, billCode: null });

    await payShare(host, split.shares[0]!.token);
    await payShare(friend, split.shares[1]!.token);
    const midway = await request(app).get(`${API}/dining/bills/${code}`).set(host);
    expect(midway.body.data.status).toBe('pending_payment');
    expect(midway.body.data.pass).toBeNull();

    const last = await payShare(friend2, split.shares[2]!.token);
    expect(last.share).toMatchObject({ paidByYou: true, paidCount: 3, billStatus: 'paid' });

    const bill = await request(app).get(`${API}/dining/bills/${code}`).set(host);
    expect(bill.body.data.status).toBe('paid');
    expect(bill.body.data.pass).not.toBeNull();

    // Everything collected was handed to the bill: the split account is back where it was.
    expect(await liabilityBalance(PLATFORM.splitCollections.code)).toBe(collectionsBefore);
    const credits = await query<{ user_id: string }>(
      `SELECT c.user_id FROM finance.wallet_credits c JOIN dining.bill_shares s ON s.id = c.source_id
        WHERE c.source_type = 'dining.bill_share' AND s.bill_payment_id = $1`,
      [bill.body.data.id],
    );
    expect(new Set(credits.rows.map((c) => c.user_id)).size).toBe(3);

    // A paid share cannot be paid again.
    const again = await request(app).post(`${API}/dining/splits/${split.shares[2]!.token}/checkout`).set(friend);
    expect(again.body.error.code).toBe('SHARE_PAID');
    await expectLedgerBalanced();
  });

  it('lets the host cover the rest, and refunds a friend who pays a share that was folded in', async () => {
    const { code, split } = await startSplit(host, 4);
    await payShare(friend, split.shares[1]!.token);

    // A friend opens checkout for share 3, then the host covers the rest before they pay.
    const stale = await request(app).post(`${API}/dining/splits/${split.shares[2]!.token}/checkout`).set(friend2);
    const cover = await request(app).post(`${API}/dining/bills/${code}/split/cover`).set(host);
    expect(cover.status).toBe(201);
    const remaining = split.totalPaise - split.shares[1]!.amountPaise;
    expect(cover.body.data.amountPaise).toBe(remaining);
    await request(app)
      .post(`${API}/dining/splits/${split.shares[0]!.token}/verify-payment`)
      .set(host)
      .send({ razorpayOrderId: cover.body.data.orderId, razorpayPaymentId: cover.body.data.mockPaymentId, razorpaySignature: cover.body.data.mockSignature })
      .expect(200);
    const bill = await request(app).get(`${API}/dining/bills/${code}`).set(host);
    expect(bill.body.data.status).toBe('paid');

    // The friend's checkout completes anyway: captured, then refunded automatically.
    const s = stale.body.data;
    await request(app)
      .post(`${API}/dining/splits/${split.shares[2]!.token}/verify-payment`)
      .set(friend2)
      .send({ razorpayOrderId: s.orderId, razorpayPaymentId: s.mockPaymentId, razorpaySignature: s.mockSignature });
    await drainOutbox();
    const late = await queryOne<{ status: string }>('SELECT status FROM payments WHERE provider_order_id = $1', [s.orderId]);
    expect(late!.status).toBe('refunded');
    await expectLedgerBalanced();
  });

  it('refunds every paid share when the window closes, and when the host calls it off', async () => {
    const collectionsBefore = await liabilityBalance(PLATFORM.splitCollections.code).catch(() => 0);
    const expired = await startSplit(host, 2);
    await payShare(friend, expired.split.shares[1]!.token);
    await query(`UPDATE dining.bill_payments SET split_expires_at = now() - interval '1 minute' WHERE code = $1`, [expired.code]);
    expect(await expireSplits()).toBeGreaterThanOrEqual(1);

    const called = await startSplit(host, 3);
    await payShare(friend2, called.split.shares[2]!.token);
    await request(app).post(`${API}/dining/bills/${called.code}/split/cancel`).set(host).expect(200);

    await drainOutbox();
    for (const code of [expired.code, called.code]) {
      const shares = await query<{ status: string }>(
        `SELECT s.status FROM dining.bill_shares s JOIN dining.bill_payments b ON b.id = s.bill_payment_id WHERE b.code = $1`,
        [code],
      );
      expect(shares.rows.map((r) => r.status).sort()).toEqual(code === expired.code ? ['refunded', 'void'] : ['refunded', 'void', 'void']);
      const bill = await queryOne<{ status: string }>('SELECT status FROM dining.bill_payments WHERE code = $1', [code]);
      expect(bill!.status).toBe('cancelled');
    }
    expect(await liabilityBalance(PLATFORM.splitCollections.code)).toBe(collectionsBefore);

    // A closed split takes no more payments.
    const closed = await request(app).post(`${API}/dining/splits/${called.split.shares[0]!.token}/checkout`).set(host);
    expect(closed.body.error.code).toBe('SPLIT_CLOSED');
    await expectLedgerBalanced();
  });

  it('rejects splits that are too small, or combined with a bank offer', async () => {
    const tiny = await request(app)
      .post(`${API}/dining/bills`)
      .set(host)
      .send({ restaurantId, billTotal: 150, splitInto: 4 });
    expect(tiny.body.error.code).toBe('SPLIT_TOO_SMALL');
    const offer = await queryOne<{ id: string }>(`SELECT id FROM dining.offers WHERE bank_name = 'HDFC Bank'`);
    const bank = await request(app).post(`${API}/dining/bills`).set(host).send({ restaurantId, billTotal: 4000, splitInto: 2, bankOfferId: offer!.id });
    expect(bank.status).toBe(422);
  });
});
