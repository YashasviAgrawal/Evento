import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { query, queryOne, withTransaction } from '../../db/pool';
import { BadRequestError, ConflictError, NotFoundError, PaymentError } from '../../utils/errors';
import { sendMailAsync } from '../../services/mail.service';
import * as gateway from '../../services/razorpay.provider';
import { confirmBooking } from '../bookings/booking.service';

/* ───────────────────────── create order ───────────────────────── */

export interface CheckoutSession {
  bookingId: string;
  bookingCode: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string | null;
  mockMode: boolean;
  /** Only populated in mock mode, so the local checkout can self-sign. */
  mockPaymentId?: string;
  mockSignature?: string;
  prefill: { name: string; email: string; contact: string };
  eventTitle: string;
}

/**
 * Create (or reuse) the gateway order for a pending booking.
 *
 * Reusing an existing `created` payment row matters: a customer who reloads
 * the checkout page must not generate a second Razorpay order for the same
 * booking, or the two could both be captured.
 */
export async function createCheckoutSession(bookingId: string, userId: string): Promise<CheckoutSession> {
  const booking = await queryOne<{
    id: string;
    booking_code: string;
    user_id: string;
    status: string;
    total_paise: number;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    hold_expires_at: Date | null;
    event_title: string;
  }>(
    `SELECT b.id, b.booking_code, b.user_id, b.status, b.total_paise,
            b.customer_name, b.customer_email, b.customer_phone, b.hold_expires_at,
            e.title AS event_title
       FROM bookings b JOIN events e ON e.id = b.event_id
      WHERE b.id = $1`,
    [bookingId],
  );

  if (!booking) throw new NotFoundError('Booking');
  if (booking.user_id !== userId) throw new NotFoundError('Booking');
  if (booking.status !== 'pending') {
    throw new ConflictError(`This booking is already ${booking.status}`, 'BOOKING_NOT_PENDING');
  }
  if (booking.hold_expires_at && booking.hold_expires_at.getTime() < Date.now()) {
    throw new ConflictError('Your reservation has expired, please book again', 'BOOKING_EXPIRED');
  }
  if (Number(booking.total_paise) <= 0) {
    throw new BadRequestError('This booking does not require payment', 'NO_PAYMENT_REQUIRED');
  }

  const existing = await queryOne<{ id: string; provider_order_id: string; amount_paise: number }>(
    `SELECT id, provider_order_id, amount_paise FROM payments
      WHERE booking_id = $1 AND status IN ('created', 'pending') AND provider_order_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [bookingId],
  );

  let orderId: string;
  if (existing && Number(existing.amount_paise) === Number(booking.total_paise)) {
    orderId = existing.provider_order_id;
  } else {
    const order = await gateway.createOrder({
      amountPaise: Number(booking.total_paise),
      receipt: booking.booking_code,
      notes: { bookingId: booking.id, bookingCode: booking.booking_code },
    });
    orderId = order.id;

    await query(
      `INSERT INTO payments (booking_id, provider, provider_order_id, amount_paise, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'created')`,
      [
        bookingId,
        gateway.isMockMode ? 'mock' : 'razorpay',
        orderId,
        booking.total_paise,
        env.razorpay.currency,
      ],
    );
  }

  const session: CheckoutSession = {
    bookingId: booking.id,
    bookingCode: booking.booking_code,
    orderId,
    amountPaise: Number(booking.total_paise),
    currency: env.razorpay.currency,
    keyId: env.razorpay.keyId ?? null,
    mockMode: gateway.isMockMode,
    prefill: {
      name: booking.customer_name,
      email: booking.customer_email,
      contact: booking.customer_phone,
    },
    eventTitle: booking.event_title,
  };

  if (gateway.isMockMode) {
    const mockPaymentId = `pay_mock_${orderId.slice(-12)}`;
    session.mockPaymentId = mockPaymentId;
    session.mockSignature = gateway.mockSignature(orderId, mockPaymentId);
  }

  return session;
}

/* ─────────────────────── verify & capture ─────────────────────── */

export interface VerifyInput {
  bookingId: string;
  orderId: string;
  paymentId: string;
  signature: string;
  method?: string;
}

/**
 * Verify the checkout callback and confirm the booking.
 *
 * The signature check is the security boundary: without it a client could POST
 * an arbitrary payment id and receive free tickets. The booking is only
 * confirmed after the HMAC matches.
 */
export async function verifyAndConfirm(input: VerifyInput, userId: string): Promise<{ status: string; bookingId: string }> {
  const payment = await queryOne<{ id: string; booking_id: string; amount_paise: number; status: string; user_id: string }>(
    `SELECT p.id, p.booking_id, p.amount_paise, p.status, b.user_id
       FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE p.provider_order_id = $1`,
    [input.orderId],
  );

  if (!payment) throw new NotFoundError('Payment order', 'ORDER_NOT_FOUND');
  if (payment.booking_id !== input.bookingId) {
    throw new BadRequestError('This order does not belong to that booking', 'ORDER_MISMATCH');
  }
  if (payment.user_id !== userId) throw new NotFoundError('Payment order', 'ORDER_NOT_FOUND');

  // Already captured — treat as success so a double-submit is harmless.
  if (payment.status === 'success') {
    return { status: 'already_confirmed', bookingId: payment.booking_id };
  }

  const valid = gateway.verifyPaymentSignature({
    orderId: input.orderId,
    paymentId: input.paymentId,
    signature: input.signature,
  });

  if (!valid) {
    await query(
      `UPDATE payments SET status = 'failed', error_code = 'SIGNATURE_MISMATCH',
                           error_description = 'Payment signature verification failed'
        WHERE id = $1`,
      [payment.id],
    );
    logger.warn({ orderId: input.orderId, bookingId: input.bookingId }, 'Payment signature verification failed');
    throw new PaymentError('Payment could not be verified', 'SIGNATURE_MISMATCH');
  }

  const remote = await gateway.fetchPayment(input.paymentId);
  const method = gateway.normaliseMethod(remote?.method ?? input.method);

  await query(
    `UPDATE payments SET status = 'success', provider_payment_id = $2, provider_signature = $3,
                         method = $4::payment_method, captured_at = now(), raw_response = $5::jsonb
      WHERE id = $1`,
    [payment.id, input.paymentId, input.signature, method, JSON.stringify(remote ?? {})],
  );

  await confirmBooking(payment.booking_id, { method, paymentId: input.paymentId });
  await sendPaymentReceipt(payment.booking_id, Number(payment.amount_paise), method, input.paymentId);

  return { status: 'confirmed', bookingId: payment.booking_id };
}

export async function markPaymentFailed(orderId: string, code?: string, description?: string): Promise<void> {
  await query(
    `UPDATE payments SET status = 'failed', error_code = $2, error_description = $3
      WHERE provider_order_id = $1 AND status IN ('created', 'pending')`,
    [orderId, code ?? 'PAYMENT_FAILED', description ?? 'Payment was not completed'],
  );
}

async function sendPaymentReceipt(
  bookingId: string,
  amountPaise: number,
  method: string,
  paymentId: string,
): Promise<void> {
  const row = await queryOne<{ customer_name: string; customer_email: string; booking_code: string; user_id: string }>(
    'SELECT customer_name, customer_email, booking_code, user_id FROM bookings WHERE id = $1',
    [bookingId],
  );
  if (!row) return;

  sendMailAsync({
    to: row.customer_email,
    template: 'payment_confirmed',
    data: {
      name: row.customer_name,
      bookingCode: row.booking_code,
      amountPaise,
      method,
      paymentId,
    },
    userId: row.user_id,
    bookingId,
  });
}

/* ──────────────────────────── webhooks ─────────────────────────── */

interface WebhookEnvelope {
  event?: string;
  payload?: {
    payment?: { entity?: Record<string, unknown> };
    refund?: { entity?: Record<string, unknown> };
  };
}

/**
 * Process a Razorpay webhook.
 *
 * Idempotency is enforced by a UNIQUE constraint on (provider, event id): the
 * insert fails for a replayed delivery and we return early. This matters
 * because Razorpay retries aggressively, and confirming a booking twice would
 * double-decrement inventory.
 *
 * The webhook is also the safety net for the case where the customer's browser
 * dies between paying and hitting /verify — the booking still gets confirmed.
 */
export async function handleWebhook(eventId: string, body: WebhookEnvelope): Promise<{ handled: boolean; reason?: string }> {
  const eventType = body.event ?? 'unknown';

  const inserted = await query<{ id: string }>(
    `INSERT INTO payment_events (provider, provider_event_id, event_type, payload)
     VALUES ('razorpay', $1, $2, $3::jsonb)
     ON CONFLICT (provider, provider_event_id) DO NOTHING
     RETURNING id`,
    [eventId, eventType, JSON.stringify(body)],
  );

  if (inserted.rows.length === 0) {
    logger.info({ eventId, eventType }, 'Duplicate webhook ignored');
    return { handled: false, reason: 'duplicate' };
  }
  const ledgerId = inserted.rows[0]!.id;

  try {
    switch (eventType) {
      case 'payment.captured':
      case 'order.paid': {
        const entity = body.payload?.payment?.entity ?? {};
        await handlePaymentCaptured(entity);
        break;
      }
      case 'payment.failed': {
        const entity = body.payload?.payment?.entity ?? {};
        const orderId = String(entity.order_id ?? '');
        if (orderId) {
          await markPaymentFailed(orderId, String(entity.error_code ?? 'PAYMENT_FAILED'), String(entity.error_description ?? ''));
        }
        break;
      }
      case 'refund.processed': {
        const entity = body.payload?.refund?.entity ?? {};
        await handleRefundProcessed(entity);
        break;
      }
      default:
        logger.debug({ eventType }, 'Unhandled webhook event type');
    }

    await query('UPDATE payment_events SET processed_at = now() WHERE id = $1', [ledgerId]);
    return { handled: true };
  } catch (err) {
    logger.error({ err, eventId, eventType }, 'Webhook processing failed');
    await query('UPDATE payment_events SET error = $2 WHERE id = $1', [
      ledgerId,
      err instanceof Error ? err.message : String(err),
    ]).catch(() => undefined);
    throw err;
  }
}

async function handlePaymentCaptured(entity: Record<string, unknown>): Promise<void> {
  const orderId = String(entity.order_id ?? '');
  const paymentId = String(entity.id ?? '');
  if (!orderId) return;

  const payment = await queryOne<{ id: string; booking_id: string; status: string; amount_paise: number }>(
    'SELECT id, booking_id, status, amount_paise FROM payments WHERE provider_order_id = $1',
    [orderId],
  );
  if (!payment) {
    logger.warn({ orderId }, 'Webhook referenced an unknown order');
    return;
  }
  if (payment.status === 'success') return;

  const method = gateway.normaliseMethod(entity.method);
  await query(
    `UPDATE payments SET status = 'success', provider_payment_id = COALESCE($2, provider_payment_id),
                         method = $3::payment_method, captured_at = now(), raw_response = $4::jsonb
      WHERE id = $1`,
    [payment.id, paymentId || null, method, JSON.stringify(entity)],
  );

  const confirmed = await confirmBooking(payment.booking_id, { method, paymentId });
  if (confirmed) {
    await sendPaymentReceipt(payment.booking_id, Number(payment.amount_paise), method, paymentId);
  }
}

async function handleRefundProcessed(entity: Record<string, unknown>): Promise<void> {
  const refundId = String(entity.id ?? '');
  if (!refundId) return;
  await query(
    `UPDATE refunds SET status = 'processed', processed_at = now() WHERE provider_refund_id = $1 AND status <> 'processed'`,
    [refundId],
  );
}

/* ──────────────────────────── refunds ─────────────────────────── */

/**
 * Execute an approved refund against the gateway and update the ledger.
 * Called by the admin refund-approval flow.
 */
export async function processRefund(refundId: string): Promise<{ status: string; providerRefundId: string | null }> {
  const refund = await queryOne<{
    id: string;
    booking_id: string;
    amount_paise: number;
    status: string;
    provider_payment_id: string | null;
    booking_total: number;
    customer_email: string;
    customer_name: string;
    booking_code: string;
    user_id: string;
  }>(
    `SELECT r.id, r.booking_id, r.amount_paise, r.status,
            p.provider_payment_id, b.total_paise AS booking_total,
            b.customer_email, b.customer_name, b.booking_code, b.user_id
       FROM refunds r
       JOIN bookings b ON b.id = r.booking_id
       LEFT JOIN payments p ON p.id = r.payment_id
      WHERE r.id = $1`,
    [refundId],
  );

  if (!refund) throw new NotFoundError('Refund');
  if (refund.status === 'processed') return { status: 'processed', providerRefundId: null };
  if (refund.status !== 'approved') {
    throw new ConflictError('Only an approved refund can be processed', 'REFUND_NOT_APPROVED');
  }

  let providerRefundId: string | null = null;
  try {
    if (refund.provider_payment_id) {
      const result = await gateway.createRefund({
        paymentId: refund.provider_payment_id,
        amountPaise: Number(refund.amount_paise),
        notes: { bookingCode: refund.booking_code },
      });
      providerRefundId = result.id;
    }
  } catch (err) {
    await query(`UPDATE refunds SET status = 'failed', admin_note = $2 WHERE id = $1`, [
      refundId,
      err instanceof Error ? err.message : 'Gateway refund failed',
    ]);
    throw err;
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE refunds SET status = 'processed', provider_refund_id = $2, processed_at = now() WHERE id = $1`,
      [refundId, providerRefundId],
    );

    // Reflect the money movement on the booking and its payment.
    const { rows } = await client.query<{ refunded: number; total: number }>(
      `UPDATE bookings
          SET refunded_paise = refunded_paise + $2,
              status = CASE
                         WHEN refunded_paise + $2 >= total_paise THEN 'refunded'::booking_status
                         ELSE 'partially_refunded'::booking_status
                       END
        WHERE id = $1
        RETURNING refunded_paise AS refunded, total_paise AS total`,
      [refund.booking_id, refund.amount_paise],
    );

    const fullyRefunded = rows[0] && Number(rows[0].refunded) >= Number(rows[0].total);
    await client.query(
      `UPDATE payments SET status = $2::payment_status
        WHERE booking_id = $1 AND status IN ('success', 'partially_refunded')`,
      [refund.booking_id, fullyRefunded ? 'refunded' : 'partially_refunded'],
    );

    await client.query("UPDATE tickets SET status = 'refunded' WHERE booking_id = $1 AND status <> 'used'", [
      refund.booking_id,
    ]);
  });

  sendMailAsync({
    to: refund.customer_email,
    template: 'refund_processed',
    data: {
      name: refund.customer_name,
      bookingCode: refund.booking_code,
      amountPaise: Number(refund.amount_paise),
    },
    userId: refund.user_id,
    bookingId: refund.booking_id,
  });

  return { status: 'processed', providerRefundId };
}

export async function requestRefund(input: {
  bookingId: string;
  userId: string;
  amountPaise?: number;
  reason: string;
}): Promise<{ id: string }> {
  const booking = await queryOne<{
    id: string;
    user_id: string;
    status: string;
    total_paise: number;
    refunded_paise: number;
  }>('SELECT id, user_id, status, total_paise, refunded_paise FROM bookings WHERE id = $1', [input.bookingId]);

  if (!booking) throw new NotFoundError('Booking');
  if (booking.user_id !== input.userId) throw new NotFoundError('Booking');
  if (!['confirmed', 'partially_refunded'].includes(booking.status)) {
    throw new ConflictError('Only a confirmed booking can be refunded', 'INVALID_STATUS');
  }

  const refundable = Number(booking.total_paise) - Number(booking.refunded_paise);
  const amount = input.amountPaise ?? refundable;
  if (amount <= 0 || amount > refundable) {
    throw new BadRequestError(`Refundable amount is ₹${(refundable / 100).toFixed(2)}`, 'INVALID_REFUND_AMOUNT');
  }

  const pending = await queryOne<{ id: string }>(
    `SELECT id FROM refunds WHERE booking_id = $1 AND status IN ('requested', 'approved')`,
    [input.bookingId],
  );
  if (pending) throw new ConflictError('A refund request is already in progress', 'REFUND_PENDING');

  const payment = await queryOne<{ id: string }>(
    `SELECT id FROM payments WHERE booking_id = $1 AND status = 'success' ORDER BY created_at DESC LIMIT 1`,
    [input.bookingId],
  );

  const { rows } = await query<{ id: string }>(
    `INSERT INTO refunds (booking_id, payment_id, requested_by, amount_paise, reason, status)
     VALUES ($1, $2, $3, $4, $5, 'requested') RETURNING id`,
    [input.bookingId, payment?.id ?? null, input.userId, amount, input.reason],
  );

  return rows[0]!;
}
