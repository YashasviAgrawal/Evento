import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, optionalAuth } from '../../middleware/auth';
import { bookingLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler, buildPageMeta, ok, paginated } from '../../utils/http';
import { audit } from '../../services/audit.service';
import * as bookingService from './booking.service';
import * as ticketService from '../tickets/ticket.service';
import { requestRefund } from '../payments/payment.service';
import {
  bookingIdParam,
  bookingListSchema,
  cancelBookingSchema,
  createBookingSchema,
  quoteSchema,
} from './booking.schema';

const router = Router();

/**
 * Price a cart without reserving inventory.
 *
 * Deliberately open to guests: making someone create an account before they
 * can even see the total is the single largest drop-off in a ticketing funnel.
 * Quoting mutates nothing, and the authoritative re-check happens when the
 * booking is actually created.
 */
router.post(
  '/quote',
  optionalAuth,
  validate({ body: quoteSchema }),
  asyncHandler(async (req, res) => {
    const quote = await bookingService.quoteBooking(req.body, req.user?.id ?? null);
    return ok(res, quote);
  }),
);

// Everything below this line requires a signed-in user.
router.use(authenticate);

/** Reserve inventory and create a pending booking. */
router.post(
  '/',
  bookingLimiter,
  validate({ body: createBookingSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    // Opportunistic sweep so seats abandoned moments ago are bookable now.
    await bookingService.expireStaleBookings().catch(() => undefined);

    const booking = await bookingService.createBooking(user.id, req.body);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.created',
      entityType: 'booking',
      entityId: booking.id,
      metadata: { eventId: req.body.eventId, total: booking.totalPaise },
    });
    return ok(res, booking, 201);
  }),
);

router.get(
  '/',
  validate({ query: bookingListSchema }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as z.infer<typeof bookingListSchema>;
    const { items, total } = await bookingService.listUserBookings(currentUser(req).id, params);
    return paginated(res, items, buildPageMeta(params.page, params.limit, total));
  }),
);

router.get(
  '/:id',
  validate({ params: bookingIdParam }),
  asyncHandler(async (req, res) => {
    const booking = await bookingService.getBookingDetail(req.params.id, currentUser(req));
    return ok(res, booking);
  }),
);

/** QR tickets for a booking. */
router.get(
  '/:id/tickets',
  validate({ params: bookingIdParam }),
  asyncHandler(async (req, res) => {
    const tickets = await ticketService.getTicketsForBooking(req.params.id, currentUser(req));
    return ok(res, tickets);
  }),
);

router.post(
  '/:id/cancel',
  validate({ params: bookingIdParam, body: cancelBookingSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const result = await bookingService.cancelBooking(req.params.id, user, req.body.reason);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.cancelled',
      entityType: 'booking',
      entityId: req.params.id,
      metadata: { reason: req.body.reason },
    });
    return ok(res, result);
  }),
);

router.post(
  '/:id/refund-request',
  validate({
    params: bookingIdParam,
    body: z.object({
      reason: z.string().trim().min(3).max(500),
      amount: z.coerce.number().min(1).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const created = await requestRefund({
      bookingId: req.params.id,
      userId: currentUser(req).id,
      amountPaise: req.body.amount ? Math.round(req.body.amount * 100) : undefined,
      reason: req.body.reason,
    });
    return ok(res, { ...created, message: 'Refund requested. Our team will review it shortly.' }, 201);
  }),
);

export default router;
