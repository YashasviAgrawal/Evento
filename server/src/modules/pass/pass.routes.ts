import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, optionalAuth } from '../../middleware/auth';
import { bookingLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import * as pass from './pass.service';

/** Tixit Pass belongs to the account, not to one product. */
const router = Router();

router.get('/', optionalAuth, asyncHandler(async (req, res) => ok(res, await pass.getPass(req.user?.id ?? null))));

router.post(
  '/checkout',
  authenticate,
  bookingLimiter,
  asyncHandler(async (req, res) => ok(res, await pass.startPassCheckout(currentUser(req).id), 201)),
);

router.post(
  '/verify-payment',
  authenticate,
  validate({
    body: z.object({
      razorpayOrderId: z.string().min(4).max(120),
      razorpayPaymentId: z.string().min(4).max(120),
      razorpaySignature: z.string().min(16).max(256),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await pass.verifyPassPayment(currentUser(req).id, {
        orderId: req.body.razorpayOrderId,
        paymentId: req.body.razorpayPaymentId,
        signature: req.body.razorpaySignature,
      }),
    ),
  ),
);

export default router;
