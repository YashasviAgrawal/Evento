import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { asyncHandler, ok } from '../../../utils/http';
import { audit } from '../../../services/audit.service';
import { localToday } from '../time';
import { requireRestaurantAccess } from './partner.middleware';
import * as partner from './partner.service';
import * as reservations from '../reservations/reservation.service';
import * as bills from '../bills/bill.service';
import * as offers from '../offers/offer.service';
import * as availability from './availability-admin.service';

/**
 * Partner console API. Every route is scoped by `:restaurantId` and the
 * caller's membership there — never by an id the client could swap.
 */
const router = Router();
router.use(authenticate);

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const restaurantParam = z.object({ restaurantId: z.string().uuid() });

router.get(
  '/restaurants',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    return ok(res, await partner.restaurantsForMember(user.id, user.role === 'admin'));
  }),
);

/**
 * Everything the Live screen needs in one call. Polled every few seconds:
 * simpler and more robust than a socket behind shared hosting, and the query
 * is two indexed scans.
 */
router.get(
  '/r/:restaurantId/live',
  requireRestaurantAccess('bills.verify'),
  validate({ params: restaurantParam, query: dateQuery }),
  asyncHandler(async (req, res) => {
    const id = req.restaurant!.id;
    const date = (req.query.date as string | undefined) ?? localToday();
    const [summary, billList, tables] = await Promise.all([
      partner.todaySummary(id, date),
      bills.listBillsForRestaurant(id, date),
      reservations.listForRestaurant(id, date),
    ]);
    return ok(res, { restaurant: req.restaurant, summary, bills: billList, reservations: tables, serverNow: new Date() });
  }),
);

router.post(
  '/r/:restaurantId/bills/:code/verify',
  requireRestaurantAccess('bills.verify'),
  validate({
    params: restaurantParam.extend({ code: z.string().min(4).max(20) }),
    body: z.object({ result: z.enum(['match', 'mismatch']), reason: z.string().trim().max(300).nullish() }),
  }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const bill = await bills.verifyAtTable(req.restaurant!.id, req.params.code!, user.id, req.body.result, req.body.reason);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: req.body.result === 'match' ? 'dining.bill.verified' : 'dining.bill.disputed',
      entityType: 'dining.bill_payment',
      entityId: null,
      metadata: { code: req.params.code, restaurantId: req.restaurant!.id, reason: req.body.reason },
    });
    return ok(res, bill);
  }),
);

router.get(
  '/r/:restaurantId/reservations',
  requireRestaurantAccess('reservations.manage'),
  validate({ params: restaurantParam, query: dateQuery }),
  asyncHandler(async (req, res) =>
    ok(res, await reservations.listForRestaurant(req.restaurant!.id, (req.query.date as string | undefined) ?? localToday())),
  ),
);

router.post(
  '/r/:restaurantId/reservations/:code/:action',
  requireRestaurantAccess('reservations.manage'),
  validate({
    params: restaurantParam.extend({
      code: z.string().min(4).max(20),
      action: z.enum(Object.keys(reservations.PARTNER_TRANSITIONS) as [reservations.PartnerAction, ...reservations.PartnerAction[]]),
    }),
    body: z.object({ reason: z.string().trim().max(200).nullish() }),
  }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await reservations.partnerTransition(
        req.restaurant!.id,
        req.params.code!,
        req.params.action as reservations.PartnerAction,
        req.body.reason,
      ),
    ),
  ),
);

router.get(
  '/r/:restaurantId/offers',
  requireRestaurantAccess('offers.manage'),
  validate({ params: restaurantParam }),
  asyncHandler(async (req, res) => ok(res, await offers.listRestaurantOffers(req.restaurant!.id))),
);

router.post(
  '/r/:restaurantId/offers',
  requireRestaurantAccess('offers.manage'),
  validate({ params: restaurantParam, body: offers.offerInput }),
  asyncHandler(async (req, res) =>
    ok(res, await offers.createRestaurantOffer(req.restaurant!.id, currentUser(req).id, req.body), 201),
  ),
);

router.patch(
  '/r/:restaurantId/offers/:offerId',
  requireRestaurantAccess('offers.manage'),
  validate({ params: restaurantParam.extend({ offerId: z.string().uuid() }), body: offers.offerInput }),
  asyncHandler(async (req, res) => ok(res, await offers.updateRestaurantOffer(req.restaurant!.id, req.params.offerId!, req.body))),
);

router.delete(
  '/r/:restaurantId/offers/:offerId',
  requireRestaurantAccess('offers.manage'),
  validate({ params: restaurantParam.extend({ offerId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await offers.archiveRestaurantOffer(req.restaurant!.id, req.params.offerId!);
    return ok(res, { archived: true });
  }),
);

router.get(
  '/r/:restaurantId/availability',
  requireRestaurantAccess('availability.manage'),
  validate({ params: restaurantParam }),
  asyncHandler(async (req, res) => ok(res, await availability.getAvailability(req.restaurant!.id))),
);

router.put(
  '/r/:restaurantId/availability/rules',
  requireRestaurantAccess('availability.manage'),
  validate({ params: restaurantParam, body: availability.rulesInput }),
  asyncHandler(async (req, res) => ok(res, await availability.replaceRules(req.restaurant!.id, req.body))),
);

router.patch(
  '/r/:restaurantId/availability/settings',
  requireRestaurantAccess('availability.manage'),
  validate({ params: restaurantParam, body: availability.settingsInput }),
  asyncHandler(async (req, res) => ok(res, await availability.updateSettings(req.restaurant!.id, req.body))),
);

router.post(
  '/r/:restaurantId/availability/closures',
  requireRestaurantAccess('availability.manage'),
  validate({
    params: restaurantParam,
    body: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), closed: z.boolean() }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await availability.setDateClosed(req.restaurant!.id, req.body.date, req.body.closed)),
  ),
);

router.get(
  '/r/:restaurantId/payouts',
  requireRestaurantAccess('payouts.view'),
  validate({ params: restaurantParam }),
  asyncHandler(async (req, res) => ok(res, await partner.payouts(req.restaurant!.id))),
);

router.get(
  '/r/:restaurantId/insights',
  requireRestaurantAccess('insights.view'),
  validate({ params: restaurantParam }),
  asyncHandler(async (req, res) => ok(res, { trend: await partner.salesTrend(req.restaurant!.id) })),
);

export default router;
