import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, optionalAuth } from '../../middleware/auth';
import { bookingLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok, paginated } from '../../utils/http';
import { localToday } from './time';
import * as catalog from './catalog/catalog.service';
import { slotsForDate } from './reservations/availability.service';
import * as reservations from './reservations/reservation.service';
import * as bills from './bills/bill.service';
import { createReview } from './reviews.service';
import * as cover from './reservations/cover.service';
// Registers the outbox handlers for dine-in emails.
import './notifications';

/** Public discovery plus the signed-in diner's bookings and bills. */
const router = Router();

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')
  .optional();

/* ───────────────────────── discovery ───────────────────────── */

router.get(
  '/home',
  validate({ query: z.object({ city: z.string().trim().min(2).max(60).default('jaipur') }) }),
  asyncHandler(async (req, res) => ok(res, await catalog.homeFeed(String(req.query.city)))),
);

router.get(
  '/restaurants',
  validate({
    query: z.object({
      q: z.string().trim().max(80).optional(),
      city: z.string().trim().max(60).optional(),
      cuisine: z.string().trim().max(40).optional(),
      tag: z.string().trim().max(40).optional(),
      offers: bool,
      payBill: bool,
      openNow: bool,
      maxCostForTwo: z.coerce.number().min(100).max(100_000).optional(),
      sort: z.enum(['relevance', 'rating', 'distance', 'cost_low', 'cost_high', 'offer']).default('relevance'),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(48).default(24),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await catalog.searchRestaurants(req.query as unknown as catalog.SearchInput);
    return paginated(res, result.items, result.meta);
  }),
);

router.get(
  '/restaurants/:slug',
  validate({ params: z.object({ slug: z.string().min(1).max(120) }) }),
  asyncHandler(async (req, res) => ok(res, await catalog.getRestaurant(req.params.slug!))),
);

router.get(
  '/restaurants/:slug/slots',
  validate({
    params: z.object({ slug: z.string().min(1).max(120) }),
    query: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      party: z.coerce.number().int().min(1).max(50).default(2),
    }),
  }),
  asyncHandler(async (req, res) => {
    const restaurant = await catalog.getRestaurant(req.params.slug!);
    const date = (req.query.date as string | undefined) ?? localToday();
    return ok(res, { date, slots: await slotsForDate(restaurant.id, date, Number(req.query.party)) });
  }),
);

router.get(
  '/collections/:slug',
  validate({ params: z.object({ slug: z.string().min(1).max(120) }) }),
  asyncHandler(async (req, res) => ok(res, await catalog.getCollection(req.params.slug!))),
);

/* ───────────────────────── bills (quote is public) ───────────────────────── */

/** Open to guests: seeing the saving before signing in is what gets them to sign in. */
router.post(
  '/bills/quote',
  optionalAuth,
  validate({ body: bills.billInput }),
  asyncHandler(async (req, res) => ok(res, await bills.quoteBill(req.body, req.user?.id ?? null))),
);

router.use(authenticate);

router.post(
  '/bills',
  bookingLimiter,
  validate({ body: bills.billInput }),
  asyncHandler(async (req, res) => {
    const key = req.header('idempotency-key')?.slice(0, 80) ?? null;
    return ok(res, await bills.createBill(currentUser(req).id, req.body, key), 201);
  }),
);

router.post(
  '/bills/:code/verify-payment',
  validate({
    params: z.object({ code: z.string().min(4).max(20) }),
    body: z.object({
      razorpayOrderId: z.string().min(4).max(120),
      razorpayPaymentId: z.string().min(4).max(120),
      razorpaySignature: z.string().min(16).max(256),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await bills.verifyBillPayment(currentUser(req).id, req.params.code!, {
        orderId: req.body.razorpayOrderId,
        paymentId: req.body.razorpayPaymentId,
        signature: req.body.razorpaySignature,
      }),
    ),
  ),
);

router.get('/bills', asyncHandler(async (req, res) => ok(res, await bills.listBillsForUser(currentUser(req).id))));

router.get(
  '/bills/:code',
  validate({ params: z.object({ code: z.string().min(4).max(20) }) }),
  asyncHandler(async (req, res) => ok(res, await bills.getBillForUser(req.params.code!, currentUser(req).id))),
);

router.post(
  '/reviews',
  validate({
    body: z.object({
      billCode: z.string().min(4).max(20),
      rating: z.coerce.number().int().min(1).max(5),
      body: z.string().trim().max(1000).nullish(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await createReview(currentUser(req).id, req.body), 201)),
);

/* ───────────────────────── reservations ───────────────────────── */

router.post(
  '/reservations',
  bookingLimiter,
  validate({
    body: z.object({
      slotId: z.string().uuid(),
      partySize: z.coerce.number().int().min(1).max(50),
      occasion: z.string().trim().max(40).nullish(),
      notes: z.string().trim().max(300).nullish(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    return ok(res, await reservations.createReservation({ id: user.id, fullName: user.fullName }, req.body), 201);
  }),
);

router.get('/reservations', asyncHandler(async (req, res) => ok(res, await reservations.listReservationsForUser(currentUser(req).id))));

router.get(
  '/reservations/:code',
  validate({ params: z.object({ code: z.string().min(4).max(20) }) }),
  asyncHandler(async (req, res) => ok(res, await reservations.getReservationForUser(req.params.code!, currentUser(req).id))),
);

router.post(
  '/reservations/:code/cancel',
  validate({ params: z.object({ code: z.string().min(4).max(20) }), body: z.object({ reason: z.string().trim().max(200).nullish() }) }),
  asyncHandler(async (req, res) =>
    ok(res, await reservations.cancelByDiner(req.params.code!, currentUser(req).id, req.body.reason)),
  ),
);

/* ───────────────────────── table deposits ───────────────────────── */

const codeParam = z.object({ code: z.string().min(4).max(20) });

router.post(
  '/reservations/:code/deposit',
  validate({ params: codeParam }),
  asyncHandler(async (req, res) => ok(res, await cover.startCoverPayment(currentUser(req).id, req.params.code!))),
);

router.post(
  '/reservations/:code/deposit/verify',
  validate({
    params: codeParam,
    body: z.object({
      razorpayOrderId: z.string().min(4).max(120),
      razorpayPaymentId: z.string().min(4).max(120),
      razorpaySignature: z.string().min(16).max(256),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await cover.verifyCoverPayment(user.id, req.params.code!, {
      orderId: req.body.razorpayOrderId,
      paymentId: req.body.razorpayPaymentId,
      signature: req.body.razorpaySignature,
    });
    return ok(res, await reservations.getReservationForUser(req.params.code!, user.id));
  }),
);

export default router;
