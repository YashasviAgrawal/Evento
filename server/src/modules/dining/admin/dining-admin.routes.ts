import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireAdmin } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { asyncHandler, ok } from '../../../utils/http';
import { audit } from '../../../services/audit.service';
import * as admin from './dining-admin.service';
import * as reviews from '../reviews.service';
import * as invoices from '../invoices/invoice.service';
import * as festivals from '../festivals/festival.service';
import * as promotions from '../promotions/promotion.service';
import { sendInvoicePdf } from '../invoices/invoice.pdf';
import { onTransferEvent } from '../../payments/payment.service';

onTransferEvent(admin.onTransferEvent);

/** Dining operations for platform admins: onboarding, go-live, staff, payouts. */
const router = Router();
router.use(authenticate, requireAdmin);

const idParam = z.object({ id: z.string().uuid() });

router.get('/restaurants', asyncHandler(async (_req, res) => ok(res, await admin.listAllRestaurants())));

router.post(
  '/restaurants',
  validate({ body: admin.restaurantInput }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const created = await admin.createRestaurant(req.body, user.id);
    await audit({ actorId: user.id, actorRole: user.role, action: 'dining.restaurant.created', entityType: 'dining.restaurant', entityId: created.id });
    return ok(res, created, 201);
  }),
);

router.get(
  '/restaurants/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await admin.getRestaurantForAdmin(req.params.id!))),
);

router.patch(
  '/restaurants/:id/commercials',
  validate({ params: idParam, body: admin.commercialsInput }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const updated = await admin.updateCommercials(req.params.id!, req.body);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'dining.restaurant.commercials',
      entityType: 'dining.restaurant',
      entityId: req.params.id!,
      metadata: req.body,
    });
    return ok(res, updated);
  }),
);

router.delete(
  '/restaurants/:id/members/:userId',
  validate({ params: idParam.extend({ userId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await admin.removeMember(req.params.id!, req.params.userId!);
    return ok(res, { removed: true });
  }),
);

router.patch(
  '/restaurants/:id/status',
  validate({ params: idParam, body: z.object({ status: z.enum(['live', 'paused', 'delisted', 'pending_review']) }) }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await admin.setRestaurantStatus(req.params.id!, req.body.status);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'dining.restaurant.status',
      entityType: 'dining.restaurant',
      entityId: req.params.id!,
      metadata: { status: req.body.status },
    });
    return ok(res, { status: req.body.status });
  }),
);

router.post(
  '/restaurants/:id/members',
  validate({
    params: idParam,
    body: z.object({ email: z.string().email(), role: z.enum(['owner', 'manager', 'host', 'cashier']) }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await admin.addMember(req.params.id!, req.body.email, req.body.role, currentUser(req).id), 201),
  ),
);

router.post(
  '/restaurants/:id/settlements',
  validate({ params: idParam, body: admin.settlementInput }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const result = await admin.recordSettlement(req.params.id!, req.body, user.id);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'dining.settlement.recorded',
      entityType: 'dining.restaurant',
      entityId: req.params.id!,
      metadata: result,
    });
    return ok(res, result, 201);
  }),
);

router.get('/offers', asyncHandler(async (_req, res) => ok(res, await admin.listPlatformOffers())));

router.post(
  '/offers',
  validate({ body: admin.platformOfferInput }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const offer = await admin.createPlatformOffer(req.body, user.id);
    await audit({ actorId: user.id, actorRole: user.role, action: 'dining.offer.created', entityType: 'dining.offer', entityId: offer.id });
    return ok(res, offer, 201);
  }),
);

router.patch(
  '/offers/:id',
  validate({ params: idParam, body: z.object({ status: z.enum(['active', 'paused', 'archived']) }) }),
  asyncHandler(async (req, res) => {
    await admin.setPlatformOfferStatus(req.params.id!, req.body.status);
    return ok(res, { status: req.body.status });
  }),
);

/* ───────────────────────── diner photo moderation ───────────────────────── */

router.get(
  '/photos',
  validate({ query: z.object({ status: z.enum(['visible', 'hidden']).default('visible') }) }),
  asyncHandler(async (req, res) =>
    ok(res, await reviews.listPhotosForModeration(req.query.status as 'visible' | 'hidden')),
  ),
);

router.patch(
  '/photos/:id',
  validate({
    params: idParam,
    body: z.object({ status: z.enum(['visible', 'hidden']), reason: z.string().trim().max(200).nullish() }),
  }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await reviews.moderatePhoto(user.id, req.params.id!, req.body);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: req.body.status === 'hidden' ? 'dining.photo.hidden' : 'dining.photo.restored',
      entityType: 'dining.review_photo',
      entityId: req.params.id!,
      metadata: req.body.reason ? { reason: req.body.reason } : undefined,
    });
    return ok(res, { status: req.body.status });
  }),
);

/* ───────────────────────── commission invoices ───────────────────────── */

const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });

router.get(
  '/invoices',
  validate({ query: monthQuery }),
  asyncHandler(async (req, res) => {
    const month = (req.query.month as string | undefined) ?? invoices.previousMonth();
    return ok(res, { month, invoices: await invoices.listInvoicesForMonth(month) });
  }),
);

router.post(
  '/invoices/generate',
  validate({ body: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }) }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const result = await invoices.generateInvoices(req.body.month);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'dining.invoices.generated',
      entityType: 'finance.invoice',
      entityId: null,
      metadata: { month: req.body.month, ...result },
    });
    return ok(res, result);
  }),
);

router.get(
  '/invoices/:id/pdf',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => sendInvoicePdf(res, await invoices.getInvoice(req.params.id!))),
);

/* ───────────────────────── festivals ───────────────────────── */

router.get('/festivals', asyncHandler(async (_req, res) => ok(res, await festivals.listFestivals())));

router.get(
  '/festivals/:slug',
  validate({ params: z.object({ slug: z.string().min(1).max(120) }) }),
  asyncHandler(async (req, res) => ok(res, await festivals.getFestival(req.params.slug!, { includeDraft: true }))),
);

router.post(
  '/festivals',
  validate({ body: festivals.festivalInput }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const created = await festivals.createFestival(user.id, req.body);
    await audit({ actorId: user.id, actorRole: user.role, action: 'dining.festival.created', entityType: 'dining.festival', entityId: created.id });
    return ok(res, created, 201);
  }),
);

router.patch(
  '/festivals/:id/status',
  validate({ params: idParam, body: z.object({ status: z.enum(['draft', 'published', 'archived']) }) }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await festivals.setFestivalStatus(req.params.id!, req.body.status);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: `dining.festival.${req.body.status}`,
      entityType: 'dining.festival',
      entityId: req.params.id!,
    });
    return ok(res, { status: req.body.status });
  }),
);

router.post(
  '/festivals/:id/restaurants',
  validate({ params: idParam, body: festivals.participantInput }),
  asyncHandler(async (req, res) => ok(res, await festivals.addParticipant(currentUser(req).id, req.params.id!, req.body), 201)),
);

router.delete(
  '/festivals/:id/restaurants/:restaurantId',
  validate({ params: idParam.extend({ restaurantId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await festivals.removeParticipant(req.params.id!, req.params.restaurantId!);
    return ok(res, { removed: true });
  }),
);

/* ───────────────────────── promoted listings ───────────────────────── */

router.get('/promotions', asyncHandler(async (_req, res) => ok(res, await promotions.listPromotions())));

router.post(
  '/promotions',
  validate({ body: promotions.promotionInput }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const created = await promotions.createPromotion(user.id, req.body);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'dining.promotion.created',
      entityType: 'dining.promotion',
      entityId: created.id,
      metadata: { totalPaise: created.totalPaise },
    });
    return ok(res, created, 201);
  }),
);

router.post(
  '/promotions/:id/cancel',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await promotions.cancelPromotion(req.params.id!);
    await audit({ actorId: user.id, actorRole: user.role, action: 'dining.promotion.cancelled', entityType: 'dining.promotion', entityId: req.params.id! });
    return ok(res, { cancelled: true });
  }),
);

export default router;
