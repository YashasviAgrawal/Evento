/**
 * Table deposits ("cover charges").
 *
 * Some restaurants ask for a per-guest deposit at peak times. The money is
 * held as a liability (`platform:cover_deposits`) and ends one of three ways:
 *
 *   credited   paid back to the diner as a line on the bill paid on Tixit
 *   refunded   diner cancelled 24 h+ ahead, or the restaurant declined
 *   forfeited  late cancellation or no-show — the restaurant keeps it, less commission
 *
 * Gateway refunds run through the outbox, so a refund that fails at the
 * gateway is retried instead of being lost; ledger postings are idempotent.
 */
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { query, queryOne, withTransaction, type Queryable } from '../../../db/pool';
import { ConflictError, NotFoundError, PaymentError } from '../../../utils/errors';
import * as gateway from '../../../services/razorpay.provider';
import { registerPaymentSubject } from '../../payments/subjects';
import { PLATFORM, post, restaurantPayable } from '../../finance/ledger';
import { enqueue, kickOutbox, onOutbox } from '../../platform/outbox';
import { queueReservationEmail } from '../notifications';

/** Cancelling at least this long before the table refunds the deposit. */
export const FREE_CANCELLATION_HOURS = 24;

export const COVER_TOPICS = { refund: 'dining.cover.refund' } as const;

export interface CoverCheckout {
  code: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string | null;
  mockMode: boolean;
  mockPaymentId?: string;
  mockSignature?: string;
  restaurantName: string;
  holdExpiresAt: Date | null;
  prefill: { name: string; email: string; contact: string };
}

/** Open (or reuse) the gateway order for a reservation's deposit. */
export async function startCoverPayment(userId: string, code: string): Promise<CoverCheckout> {
  const row = await queryOne<{
    id: string;
    status: string;
    cover_paise: number;
    hold_expires_at: Date | null;
    restaurant_name: string;
    full_name: string;
    email: string;
    phone: string | null;
    order_id: string | null;
  }>(
    `SELECT v.id, v.status, v.cover_paise, v.hold_expires_at, r.name AS restaurant_name, u.full_name, u.email, u.phone,
            (SELECT p.provider_order_id FROM payments p WHERE p.reservation_id = v.id AND p.status IN ('created', 'pending')
              ORDER BY p.created_at DESC LIMIT 1) AS order_id
       FROM dining.reservations v
       JOIN dining.restaurants r ON r.id = v.restaurant_id
       JOIN users u ON u.id = v.user_id
      WHERE v.code = $1 AND v.user_id = $2`,
    [code, userId],
  );
  if (!row) throw new NotFoundError('Reservation');
  if (row.status !== 'pending_payment') throw new ConflictError('This deposit has already been handled', 'COVER_NOT_PENDING');
  if (row.hold_expires_at && row.hold_expires_at.getTime() < Date.now()) {
    throw new ConflictError('Your table hold expired — please book again', 'HOLD_EXPIRED');
  }

  let orderId = row.order_id;
  if (!orderId) {
    const order = await gateway.createOrder({
      amountPaise: Number(row.cover_paise),
      receipt: code,
      notes: { reservationCode: code, product: 'dinein-deposit' },
    });
    orderId = order.id;
    await query(
      `INSERT INTO payments (reservation_id, provider, provider_order_id, amount_paise, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'created')`,
      [row.id, gateway.isMockMode ? 'mock' : 'razorpay', orderId, row.cover_paise, env.razorpay.currency],
    );
  }

  const session: CoverCheckout = {
    code,
    orderId,
    amountPaise: Number(row.cover_paise),
    currency: env.razorpay.currency,
    keyId: env.razorpay.keyId ?? null,
    mockMode: gateway.isMockMode,
    restaurantName: row.restaurant_name,
    holdExpiresAt: row.hold_expires_at,
    prefill: { name: row.full_name, email: row.email, contact: row.phone ?? '' },
  };
  if (gateway.isMockMode) {
    session.mockPaymentId = `pay_mock_${orderId.slice(-12)}`;
    session.mockSignature = gateway.mockSignature(orderId, session.mockPaymentId);
  }
  return session;
}

export async function verifyCoverPayment(
  userId: string,
  code: string,
  input: { orderId: string; paymentId: string; signature: string },
): Promise<void> {
  const payment = await queryOne<{ id: string; reservation_id: string; status: string; user_id: string; code: string }>(
    `SELECT p.id, p.reservation_id, p.status, v.user_id, v.code
       FROM payments p JOIN dining.reservations v ON v.id = p.reservation_id
      WHERE p.provider_order_id = $1`,
    [input.orderId],
  );
  if (!payment || payment.user_id !== userId || payment.code !== code) throw new NotFoundError('Payment order');
  if (payment.status === 'success') return;

  if (!gateway.verifyPaymentSignature(input)) {
    await query(`UPDATE payments SET status = 'failed', error_code = 'SIGNATURE_MISMATCH' WHERE id = $1 AND status <> 'success'`, [
      payment.id,
    ]);
    throw new PaymentError('Payment could not be verified', 'SIGNATURE_MISMATCH');
  }
  const remote = await gateway.fetchPayment(input.paymentId);
  const method = gateway.normaliseMethod(remote?.method);
  await query(
    `UPDATE payments SET status = 'success', provider_payment_id = $2, provider_signature = $3,
            method = $4::payment_method, captured_at = now(), raw_response = $5::jsonb
      WHERE id = $1 AND status <> 'success'`,
    [payment.id, input.paymentId, input.signature, method, JSON.stringify(remote ?? {})],
  );
  await markCoverPaid(payment.reservation_id);
}

/**
 * Deposit captured: the held covers become a booking. If the hold lapsed
 * before the money arrived, the deposit is refunded automatically.
 */
export async function markCoverPaid(reservationId: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; slot_id: string; party_size: number; cover_paise: number; auto_accept: boolean }>(
      `UPDATE dining.reservations v
          SET status = CASE WHEN r.auto_accept THEN 'confirmed'::dining.reservation_status ELSE 'placed'::dining.reservation_status END,
              accepted_at = CASE WHEN r.auto_accept THEN now() END,
              cover_status = 'paid', hold_expires_at = NULL
         FROM dining.restaurants r
        WHERE v.id = $1 AND v.status = 'pending_payment' AND r.id = v.restaurant_id
        RETURNING v.id, v.slot_id, v.party_size, v.cover_paise, r.auto_accept`,
      [reservationId],
    );
    const row = rows[0];
    if (!row) {
      // Paid after the hold lapsed (or a duplicate callback): give it back if it is still owed.
      const late = await client.query<{ cover_status: string }>(
        `UPDATE dining.reservations SET cover_status = 'paid'
          WHERE id = $1 AND cover_status = 'pending' AND status IN ('expired', 'cancelled_by_diner')
          RETURNING cover_status`,
        [reservationId],
      );
      if (late.rows[0]) {
        await postDepositReceived(client, reservationId, null);
        await enqueue(client, COVER_TOPICS.refund, { reservationId });
      }
      return;
    }
    await client.query('UPDATE dining.slots SET held = GREATEST(held - $2, 0), booked = booked + $2 WHERE id = $1', [
      row.slot_id,
      row.party_size,
    ]);
    await postDepositReceived(client, reservationId, Number(row.cover_paise));
    await queueReservationEmail(client, reservationId, row.auto_accept ? 'confirmed' : 'requested');
  });
  kickOutbox();
}

async function postDepositReceived(client: Queryable, reservationId: string, amount: number | null): Promise<void> {
  const value =
    amount ??
    Number((await client.query<{ cover_paise: number }>('SELECT cover_paise FROM dining.reservations WHERE id = $1', [reservationId])).rows[0]
      ?.cover_paise ?? 0);
  await post(client, {
    kind: 'cover_paid',
    sourceType: 'dining.reservation',
    sourceId: reservationId,
    idempotencyKey: `cover_paid:${reservationId}`,
    entries: [
      { account: PLATFORM.gatewayClearing, amountPaise: value },
      { account: PLATFORM.coverDeposits, amountPaise: -value },
    ],
  });
}

/** Queue a refund of a paid deposit (diner cancelled early, restaurant declined). */
export async function queueCoverRefund(client: Queryable, reservationId: string): Promise<void> {
  await enqueue(client, COVER_TOPICS.refund, { reservationId });
}

/** The restaurant keeps the deposit, less commission (late cancel, no-show). */
export async function forfeitCover(client: Queryable, reservationId: string): Promise<void> {
  const { rows } = await client.query<{ cover_paise: number; restaurant_id: string; name: string; commission_bps: number }>(
    `UPDATE dining.reservations v SET cover_status = 'forfeited'
       FROM dining.restaurants r
      WHERE v.id = $1 AND v.cover_status = 'paid' AND r.id = v.restaurant_id
      RETURNING v.cover_paise, v.restaurant_id, r.name, r.commission_bps`,
    [reservationId],
  );
  const row = rows[0];
  if (!row) return;
  const cover = Number(row.cover_paise);
  const commission = Math.round((cover * row.commission_bps) / 10_000);
  const gst = Math.round((commission * 18) / 100);
  await post(client, {
    kind: 'cover_forfeited',
    sourceType: 'dining.reservation',
    sourceId: reservationId,
    idempotencyKey: `cover_forfeited:${reservationId}`,
    entries: [
      { account: PLATFORM.coverDeposits, amountPaise: cover },
      { account: restaurantPayable(row.restaurant_id, row.name), amountPaise: -(cover - commission - gst) },
      { account: PLATFORM.commissionRevenue, amountPaise: -commission },
      { account: PLATFORM.gstOutput, amountPaise: -gst },
    ],
  });
}

/** Refund handler: gateway first, then status and ledger. Idempotent. */
async function refundCover(reservationId: string): Promise<void> {
  const row = await queryOne<{ cover_paise: number; cover_status: string; code: string; payment_id: string | null }>(
    `SELECT v.cover_paise, v.cover_status, v.code,
            (SELECT p.provider_payment_id FROM payments p WHERE p.reservation_id = v.id AND p.status = 'success'
              ORDER BY p.created_at DESC LIMIT 1) AS payment_id
       FROM dining.reservations v WHERE v.id = $1`,
    [reservationId],
  );
  if (!row || row.cover_status !== 'paid') return;

  const refund = row.payment_id
    ? await gateway.createRefund({ paymentId: row.payment_id, amountPaise: Number(row.cover_paise), notes: { reservationCode: row.code } })
    : null;

  await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE dining.reservations SET cover_status = 'refunded' WHERE id = $1 AND cover_status = 'paid'`,
      [reservationId],
    );
    if (!updated.rowCount) return;
    await client.query(
      `UPDATE payments SET status = 'refunded' WHERE reservation_id = $1 AND status = 'success'`,
      [reservationId],
    );
    await post(client, {
      kind: 'cover_refunded',
      sourceType: 'dining.reservation',
      sourceId: reservationId,
      idempotencyKey: `cover_refunded:${reservationId}`,
      memo: refund ? `Refund ${refund.id}` : 'Refund',
      entries: [
        { account: PLATFORM.coverDeposits, amountPaise: Number(row.cover_paise) },
        { account: PLATFORM.gatewayClearing, amountPaise: -Number(row.cover_paise) },
      ],
    });
  });
  logger.info({ reservation: row.code }, 'Table deposit refunded');
}

onOutbox(COVER_TOPICS.refund, (payload) => refundCover(String(payload.reservationId)));

registerPaymentSubject('reservation', {
  async captured(subjectId) {
    await markCoverPaid(subjectId);
  },
});
