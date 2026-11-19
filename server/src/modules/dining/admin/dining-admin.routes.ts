import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireAdmin } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { asyncHandler, ok } from '../../../utils/http';
import { audit } from '../../../services/audit.service';
import * as admin from './dining-admin.service';
import * as reviews from '../reviews.service';
import * as invoices from '../invoices/invoice.service';
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

export default router;
