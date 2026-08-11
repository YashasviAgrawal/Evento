import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import { logger } from '../../config/logger';
import { verifyWebhookSignature } from '../../services/razorpay.provider';
import { env } from '../../config/env';
import * as paymentService from './payment.service';

const router = Router();

/* ─────────────────── authenticated checkout ─────────────────── */

router.post(
  '/checkout',
  authenticate,
  validate({ body: z.object({ bookingId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const session = await paymentService.createCheckoutSession(req.body.bookingId, currentUser(req).id);
    return ok(res, session);
  }),
);

router.post(
  '/verify',
  authenticate,
  validate({
    body: z.object({
      bookingId: z.string().uuid(),
      razorpayOrderId: z.string().min(4).max(120),
      razorpayPaymentId: z.string().min(4).max(120),
      razorpaySignature: z.string().min(16).max(256),
      method: z.string().max(40).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await paymentService.verifyAndConfirm(
      {
        bookingId: req.body.bookingId,
        orderId: req.body.razorpayOrderId,
        paymentId: req.body.razorpayPaymentId,
        signature: req.body.razorpaySignature,
        method: req.body.method,
      },
      currentUser(req).id,
    );
    return ok(res, result);
  }),
);

/** Client-side failure report; the authoritative signal is still the webhook. */
router.post(
  '/failed',
  authenticate,
  validate({
    body: z.object({
      razorpayOrderId: z.string().min(4).max(120),
      code: z.string().max(80).optional(),
      description: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    await paymentService.markPaymentFailed(req.body.razorpayOrderId, req.body.code, req.body.description);
    return ok(res, { acknowledged: true });
  }),
);

/* ─────────────────────────── webhook ─────────────────────────── */

/**
 * Razorpay webhook.
 *
 * Unauthenticated by design — the HMAC over the raw body is the authentication.
 * `express.raw` is applied on this path in app.ts so the exact bytes Razorpay
 * signed are available; parsing to JSON first would break the signature.
 *
 * Always responds 200 on a signature-valid delivery, even if our own
 * processing throws, so the gateway does not hammer us with retries for a bug
 * on our side — the failure is recorded in payment_events for replay.
 */
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    if (!env.razorpay.webhookSecret) {
      logger.warn('Received a webhook but RAZORPAY_WEBHOOK_SECRET is not configured — ignoring');
      return res.status(202).json({ success: true, data: { ignored: 'webhook secret not configured' } });
    }
    if (typeof signature !== 'string' || !verifyWebhookSignature(rawBody, signature)) {
      logger.warn('Rejected webhook with an invalid signature');
      return res.status(400).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
    }

    const body = typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody.toString('utf8'));

    // Razorpay's delivery id makes replays detectable; fall back to a hash of
    // the signature, which is unique per delivery body.
    const eventId = String(req.headers['x-razorpay-event-id'] ?? signature.slice(0, 64));

    try {
      const result = await paymentService.handleWebhook(eventId, body);
      return res.status(200).json({ success: true, data: result });
    } catch {
      return res.status(200).json({ success: true, data: { handled: false, reason: 'deferred' } });
    }
  }),
);

export default router;
