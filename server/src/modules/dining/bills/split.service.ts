import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { query, queryOne, withTransaction, type Queryable } from '../../../db/pool';
import * as gateway from '../../../services/razorpay.provider';
import { ConflictError, NotFoundError, PaymentError } from '../../../utils/errors';
import { PLATFORM, post } from '../../finance/ledger';
import { releaseForBill } from '../../finance/wallet';
import { enqueue, kickOutbox, onOutbox } from '../../platform/outbox';
import { registerPaymentSubject } from '../../payments/subjects';
import { shortName } from '../reviews.service';
import { settleBill, type BillCheckout } from './bill.service';
import { SPLIT_TOPICS } from './split-shares';

/**
 * Split the bill.
 *
 * The host prices the bill once — offers, coupon, their own wallet — and the
 * payable amount is divided into equal shares (the host's share absorbs the
 * odd paise). Each share has its own unguessable link and is paid by whoever
 * opens it, signed in. Money lands in a split-collections liability; when the
 * last share is paid the bill settles exactly like a single payment. If the
 * window closes first, or the host calls it off, every paid share is refunded.
 *
 * Races are settled at capture time, under a row lock: a payment for a share
 * that is no longer open (paid by someone else, merged into "cover the rest",
 * or the split expired) is refunded automatically.
 */

/* ───────────────────────── reading ───────────────────────── */

interface ShareRow {
  id: string;
  share_no: number;
  amount_paise: number;
  token: string;
  status: 'open' | 'paid' | 'void' | 'refunded';
  paid_at: Date | null;
  payer_user_id: string | null;
  payer_name: string | null;
}

async function sharesOf(billId: string, client: Queryable = { query }): Promise<ShareRow[]> {
  const { rows } = await client.query<ShareRow>(
    `SELECT s.id, s.share_no, s.amount_paise, s.token, s.status, s.paid_at, s.payer_user_id, u.full_name AS payer_name
       FROM dining.bill_shares s LEFT JOIN users u ON u.id = s.payer_user_id
      WHERE s.bill_payment_id = $1 ORDER BY s.share_no`,
    [billId],
  );
  return rows;
}

function summarise(shares: ShareRow[]) {
  const live = shares.filter((share) => share.status !== 'void');
  const paid = live.filter((share) => share.status === 'paid');
  return {
    shareCount: live.length,
    paidCount: paid.length,
    paidPaise: paid.reduce((sum, share) => sum + Number(share.amount_paise), 0),
    remainingPaise: live.filter((share) => share.status === 'open').reduce((sum, share) => sum + Number(share.amount_paise), 0),
  };
}

/** The host's view: every share, its link, who paid. */
export async function getSplitForHost(code: string, userId: string) {
  const bill = await queryOne<{ id: string; status: string; split_count: number; split_expires_at: Date | null; amount_payable_paise: number }>(
    `SELECT id, status, split_count, split_expires_at, amount_payable_paise FROM dining.bill_payments WHERE code = $1 AND user_id = $2`,
    [code, userId],
  );
  if (!bill || bill.split_count < 2) throw new NotFoundError('Split');
  const shares = await sharesOf(bill.id);
  return {
    status: bill.status,
    expiresAt: bill.split_expires_at,
    totalPaise: Number(bill.amount_payable_paise),
    ...summarise(shares),
    shares: shares
      .filter((share) => share.status !== 'void')
      .map((share) => ({
        shareNo: share.share_no,
        amountPaise: Number(share.amount_paise),
        status: share.status,
        token: share.token,
        paidAt: share.paid_at,
        paidBy: share.payer_user_id === userId ? 'You' : share.payer_name ? shortName(share.payer_name) : null,
      })),
  };
}

/** What a friend sees when they open a share link. */
export async function getShareByToken(token: string, viewerId: string | null) {
  const row = await queryOne<{
    id: string;
    share_no: number;
    amount_paise: number;
    status: ShareRow['status'];
    payer_user_id: string | null;
    bill_id: string;
    bill_code: string;
    bill_status: string;
    host_id: string;
    host_name: string;
    split_expires_at: Date;
    bill_total_paise: number;
    amount_payable_paise: number;
    pricing: { totalDiscountPaise: number };
    restaurant_name: string;
    restaurant_slug: string;
    restaurant_logo: string | null;
    locality: string;
  }>(
    `SELECT s.id, s.share_no, s.amount_paise, s.status, s.payer_user_id,
            b.id AS bill_id, b.code AS bill_code, b.status AS bill_status, b.user_id AS host_id, u.full_name AS host_name,
            b.split_expires_at, b.bill_total_paise, b.amount_payable_paise, b.pricing,
            r.name AS restaurant_name, r.slug AS restaurant_slug, r.logo_url AS restaurant_logo, r.locality
       FROM dining.bill_shares s
       JOIN dining.bill_payments b ON b.id = s.bill_payment_id
       JOIN users u ON u.id = b.user_id
       JOIN dining.restaurants r ON r.id = b.restaurant_id
      WHERE s.token = $1`,
    [token],
  );
  if (!row) throw new NotFoundError('Share');
  const shares = await sharesOf(row.bill_id);
  return {
    shareNo: row.share_no,
    amountPaise: Number(row.amount_paise),
    status: row.status,
    paidByYou: Boolean(viewerId && row.payer_user_id === viewerId),
    isHost: viewerId === row.host_id,
    host: shortName(row.host_name).split(' ')[0],
    billCode: viewerId === row.host_id ? row.bill_code : null,
    billStatus: row.bill_status,
    expiresAt: row.split_expires_at,
    billTotalPaise: Number(row.bill_total_paise),
    totalPayablePaise: Number(row.amount_payable_paise),
    savedPaise: Number(row.pricing.totalDiscountPaise ?? 0),
    restaurant: { name: row.restaurant_name, slug: row.restaurant_slug, logoUrl: row.restaurant_logo, locality: row.locality },
    ...summarise(shares),
  };
}

/* ───────────────────────── paying a share ───────────────────────── */

/**
 * Open (or reuse) a gateway order for one share, for this payer. Orders are
 * per payer so the person who actually paid is always known.
 */
export async function startShareCheckout(token: string, userId: string): Promise<BillCheckout> {
  const share = await queryOne<{
    id: string;
    amount_paise: number;
    status: string;
    bill_status: string;
    split_expires_at: Date;
    restaurant_name: string;
    full_name: string;
    email: string;
    phone: string | null;
  }>(
    `SELECT s.id, s.amount_paise, s.status, b.status AS bill_status, b.split_expires_at, r.name AS restaurant_name,
            u.full_name, u.email, u.phone
       FROM dining.bill_shares s
       JOIN dining.bill_payments b ON b.id = s.bill_payment_id
       JOIN dining.restaurants r ON r.id = b.restaurant_id
       JOIN users u ON u.id = $2
      WHERE s.token = $1`,
    [token, userId],
  );
  if (!share) throw new NotFoundError('Share');
  if (share.status === 'paid') throw new ConflictError('This share has already been paid', 'SHARE_PAID');
  if (share.status !== 'open' || share.bill_status !== 'pending_payment' || share.split_expires_at.getTime() <= Date.now()) {
    throw new ConflictError('This split is closed', 'SPLIT_CLOSED');
  }

  const amount = Number(share.amount_paise);
  const existing = await queryOne<{ provider_order_id: string }>(
    `SELECT provider_order_id FROM payments
      WHERE bill_share_id = $1 AND payer_user_id = $2 AND amount_paise = $3 AND status IN ('created', 'pending')
      ORDER BY created_at DESC LIMIT 1`,
    [share.id, userId, amount],
  );
  let orderId = existing?.provider_order_id;
  if (!orderId) {
    const order = await gateway.createOrder({ amountPaise: amount, receipt: `share-${share.id.slice(0, 8)}`, notes: { shareId: share.id, product: 'dinein' } });
    orderId = order.id;
    await query(
      `INSERT INTO payments (bill_share_id, payer_user_id, provider, provider_order_id, amount_paise, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'created')`,
      [share.id, userId, gateway.isMockMode ? 'mock' : 'razorpay', orderId, amount, env.razorpay.currency],
    );
  }

  const session: BillCheckout = {
    code: token,
    orderId,
    amountPaise: amount,
    currency: env.razorpay.currency,
    keyId: env.razorpay.keyId ?? null,
    mockMode: gateway.isMockMode,
    restaurantName: share.restaurant_name,
    prefill: { name: share.full_name, email: share.email, contact: share.phone ?? '' },
  };
  if (gateway.isMockMode) {
    session.mockPaymentId = `pay_mock_${orderId.slice(-12)}`;
    session.mockSignature = gateway.mockSignature(orderId, session.mockPaymentId);
  }
  return session;
}

export async function verifyShareCheckout(
  token: string,
  userId: string,
  input: { orderId: string; paymentId: string; signature: string },
): Promise<void> {
  const payment = await queryOne<{ id: string; status: string; payer_user_id: string; token: string }>(
    `SELECT p.id, p.status, p.payer_user_id, s.token
       FROM payments p JOIN dining.bill_shares s ON s.id = p.bill_share_id
      WHERE p.provider_order_id = $1`,
    [input.orderId],
  );
  if (!payment || payment.payer_user_id !== userId || payment.token !== token) throw new NotFoundError('Payment order');
  if (payment.status === 'success') return;

  if (!gateway.verifyPaymentSignature(input)) {
    await query(`UPDATE payments SET status = 'failed', error_code = 'SIGNATURE_MISMATCH' WHERE id = $1 AND status <> 'success'`, [payment.id]);
    throw new PaymentError('Payment could not be verified', 'SIGNATURE_MISMATCH');
  }
  const remote = await gateway.fetchPayment(input.paymentId);
  const method = gateway.normaliseMethod(remote?.method);
  const updated = await query(
    `UPDATE payments SET status = 'success', provider_payment_id = $2, provider_signature = $3,
            method = $4::payment_method, captured_at = now(), raw_response = $5::jsonb
      WHERE id = $1 AND status <> 'success'`,
    [payment.id, input.paymentId, input.signature, method, JSON.stringify(remote ?? {})],
  );
  if (updated.rowCount) await markShareCaptured(payment.id, { method, paymentId: input.paymentId });
}

/**
 * A share payment was captured (client callback or webhook — whichever comes
 * first; idempotent per payment). Collect it, then either mark the share paid
 * and settle the bill if it was the last, or refund it if the share is gone.
 */
export async function markShareCaptured(paymentRowId: string, context: { method: string; paymentId: string }): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{
      share_id: string;
      amount_paise: number;
      payer_user_id: string;
      share_amount: number;
      share_status: string;
      bill_id: string;
      bill_status: string;
      split_expires_at: Date;
    }>(
      `SELECT s.id AS share_id, p.amount_paise, p.payer_user_id, s.amount_paise AS share_amount, s.status AS share_status,
              b.id AS bill_id, b.status AS bill_status, b.split_expires_at
         FROM payments p
         JOIN dining.bill_shares s ON s.id = p.bill_share_id
         JOIN dining.bill_payments b ON b.id = s.bill_payment_id
        WHERE p.id = $1 AND p.status = 'success'
        FOR UPDATE OF s, b`,
      [paymentRowId],
    );
    const row = rows[0];
    if (!row) return;

    const amount = Number(row.amount_paise);
    const posted = await post(client, {
      kind: 'split_share_collected',
      sourceType: 'payment',
      sourceId: paymentRowId,
      idempotencyKey: `split_share_collected:${paymentRowId}`,
      memo: `Split share via ${context.method} (${context.paymentId})`,
      entries: [
        { account: PLATFORM.gatewayClearing, amountPaise: amount },
        { account: PLATFORM.splitCollections, amountPaise: -amount },
      ],
    });
    if (!posted) return; // already handled

    const usable =
      row.share_status === 'open' && row.bill_status === 'pending_payment' && amount === Number(row.share_amount);
    if (!usable) {
      logger.warn({ share: row.share_id, payment: paymentRowId }, 'Payment for a closed split share — refunding');
      await enqueue(client, SPLIT_TOPICS.refund, { paymentId: paymentRowId, closeShare: false });
      return;
    }

    await client.query(
      `UPDATE dining.bill_shares SET status = 'paid', payer_user_id = $2, paid_at = now() WHERE id = $1`,
      [row.share_id, row.payer_user_id],
    );
    const open = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dining.bill_shares WHERE bill_payment_id = $1 AND status = 'open'`,
      [row.bill_id],
    );
    if (open.rows[0]!.n === 0) {
      await settleBill(client, row.bill_id, { method: 'split', paymentId: context.paymentId });
    }
  });
  kickOutbox();
}

/* ───────────────────────── host actions ───────────────────────── */

async function lockHostBill(client: Queryable, code: string, userId: string) {
  const { rows } = await client.query<{ id: string; status: string; split_count: number }>(
    `SELECT id, status, split_count FROM dining.bill_payments WHERE code = $1 AND user_id = $2 FOR UPDATE`,
    [code, userId],
  );
  const bill = rows[0];
  if (!bill || bill.split_count < 2) throw new NotFoundError('Split');
  if (bill.status !== 'pending_payment') throw new ConflictError('This split is already closed', 'SPLIT_CLOSED');
  return bill;
}

/**
 * "I'll cover the rest": the open shares fold into one, for the host to pay.
 * Orders already opened for the folded shares are superseded; if one of them
 * is paid anyway, it is refunded at capture.
 */
export async function coverRemaining(code: string, userId: string): Promise<BillCheckout> {
  const token = await withTransaction(async (client) => {
    const bill = await lockHostBill(client, code, userId);
    const { rows: open } = await client.query<{ id: string; amount_paise: number; token: string }>(
      `SELECT id, amount_paise, token FROM dining.bill_shares WHERE bill_payment_id = $1 AND status = 'open'
        ORDER BY share_no FOR UPDATE`,
      [bill.id],
    );
    if (open.length === 0) throw new ConflictError('Every share is already paid', 'NOTHING_LEFT');
    const [target, ...rest] = open;
    if (rest.length > 0) {
      const total = open.reduce((sum, share) => sum + Number(share.amount_paise), 0);
      await client.query(`UPDATE dining.bill_shares SET status = 'void' WHERE id = ANY($1::uuid[])`, [rest.map((s) => s.id)]);
      await client.query(`UPDATE dining.bill_shares SET amount_paise = $2 WHERE id = $1`, [target!.id, total]);
      await client.query(
        `UPDATE payments SET status = 'failed', error_code = 'SUPERSEDED'
          WHERE bill_share_id = ANY($1::uuid[]) AND status = 'created'`,
        [open.map((s) => s.id)],
      );
    }
    return target!.token;
  });
  return startShareCheckout(token, userId);
}

/** Call the split off: the bill is cancelled and every paid share refunded. */
export async function cancelSplit(code: string, userId: string): Promise<void> {
  await withTransaction(async (client) => {
    const bill = await lockHostBill(client, code, userId);
    await closeSplit(client, bill.id);
  });
  kickOutbox();
}

async function closeSplit(client: Queryable, billId: string): Promise<void> {
  await client.query(`UPDATE dining.bill_payments SET status = 'cancelled' WHERE id = $1`, [billId]);
  await client.query(`UPDATE dining.bill_shares SET status = 'void' WHERE bill_payment_id = $1 AND status = 'open'`, [billId]);
  await releaseForBill(client, billId);
  const { rows } = await client.query<{ id: string }>(
    `SELECT p.id FROM payments p JOIN dining.bill_shares s ON s.id = p.bill_share_id
      WHERE s.bill_payment_id = $1 AND s.status = 'paid' AND p.status = 'success'`,
    [billId],
  );
  for (const payment of rows) await enqueue(client, SPLIT_TOPICS.refund, { paymentId: payment.id, closeShare: true });
}

/** Scheduler: splits whose window closed before the last share are unwound. */
export async function expireSplits(): Promise<number> {
  const count = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM dining.bill_payments
        WHERE split_count > 1 AND status = 'pending_payment' AND split_expires_at <= now()
        LIMIT 200 FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows) await closeSplit(client, row.id);
    return rows.length;
  });
  if (count) kickOutbox();
  return count;
}

/* ───────────────────────── refunds ───────────────────────── */

/** Gateway first, then status and ledger. Idempotent per payment. */
async function refundSharePayment(paymentId: string, closeShare: boolean): Promise<void> {
  const payment = await queryOne<{ provider_payment_id: string | null; amount_paise: number; status: string; bill_share_id: string }>(
    'SELECT provider_payment_id, amount_paise, status, bill_share_id FROM payments WHERE id = $1',
    [paymentId],
  );
  if (!payment || payment.status !== 'success') return;
  const amount = Number(payment.amount_paise);
  const refund = payment.provider_payment_id
    ? await gateway.createRefund({ paymentId: payment.provider_payment_id, amountPaise: amount, notes: { shareId: payment.bill_share_id } })
    : null;

  await withTransaction(async (client) => {
    const updated = await client.query(`UPDATE payments SET status = 'refunded' WHERE id = $1 AND status = 'success'`, [paymentId]);
    if (!updated.rowCount) return;
    if (closeShare) {
      await client.query(`UPDATE dining.bill_shares SET status = 'refunded', refunded_at = now() WHERE id = $1 AND status = 'paid'`, [
        payment.bill_share_id,
      ]);
    }
    await post(client, {
      kind: 'split_share_refunded',
      sourceType: 'payment',
      sourceId: paymentId,
      idempotencyKey: `split_share_refunded:${paymentId}`,
      memo: refund ? `Refund ${refund.id}` : 'Refund',
      entries: [
        { account: PLATFORM.splitCollections, amountPaise: amount },
        { account: PLATFORM.gatewayClearing, amountPaise: -amount },
      ],
    });
  });
}

onOutbox(SPLIT_TOPICS.refund, (payload) => refundSharePayment(String(payload.paymentId), Boolean(payload.closeShare)));

registerPaymentSubject('bill_share', {
  async captured(_shareId, context) {
    await markShareCaptured(context.paymentRowId, context);
  },
});
