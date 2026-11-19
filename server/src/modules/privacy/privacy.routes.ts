import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { authenticate, currentUser, optionalAuth, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, clientIp, ok } from '../../utils/http';
import { audit } from '../../services/audit.service';
import { TooManyRequestsError } from '../../utils/errors';
import * as privacy from './privacy.service';

/** Diner-facing privacy centre and the public grievance desk. */
export const privacyRoutes = Router();

const grievanceLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  skip: () => env.isTest,
  handler: (_req, _res, next) => next(new TooManyRequestsError('Too many complaints from this connection. Please try again later.')),
});

privacyRoutes.get('/grievance-officer', (_req, res) => ok(res, { ...env.grievanceOfficer, responseDays: privacy.RESPONSE_DAYS }));

privacyRoutes.post(
  '/grievances',
  grievanceLimiter,
  optionalAuth,
  validate({ body: privacy.grievanceInput }),
  asyncHandler(async (req, res) => ok(res, await privacy.createGrievance(req.body, req.user?.id ?? null), 201)),
);

privacyRoutes.get(
  '/consents',
  authenticate,
  asyncHandler(async (req, res) => ok(res, { noticeVersion: privacy.NOTICE_VERSION, consents: await privacy.getConsents(currentUser(req).id) })),
);

privacyRoutes.put(
  '/consents',
  authenticate,
  validate({ body: privacy.consentInput }),
  asyncHandler(async (req, res) => ok(res, await privacy.setConsents(currentUser(req).id, req.body, clientIp(req)))),
);

privacyRoutes.get(
  '/export',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await privacy.exportData(currentUser(req).id);
    res.setHeader('Content-Disposition', 'attachment; filename="tixit-my-data.json"');
    return ok(res, data);
  }),
);

privacyRoutes.get('/requests', authenticate, asyncHandler(async (req, res) => ok(res, await privacy.listMyRequests(currentUser(req).id))));

privacyRoutes.post(
  '/requests',
  authenticate,
  validate({ body: privacy.requestInput }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    return ok(res, await privacy.createRequest(user, req.body), 201);
  }),
);

/** The grievance and data-protection desk for platform admins. */
export const privacyAdminRoutes = Router();
privacyAdminRoutes.use(authenticate, requireAdmin);

privacyAdminRoutes.get('/requests', asyncHandler(async (_req, res) => ok(res, await privacy.listRequests())));
privacyAdminRoutes.patch(
  '/requests/:id',
  validate({ params: z.object({ id: z.string().uuid() }), body: privacy.resolveInput }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await privacy.resolveRequest(req.params.id!, req.body, user.id);
    await audit({ actorId: user.id, actorRole: user.role, action: `privacy.request.${req.body.status}`, entityType: 'privacy.request', entityId: req.params.id! });
    return ok(res, { status: req.body.status });
  }),
);
privacyAdminRoutes.get('/grievances', asyncHandler(async (_req, res) => ok(res, await privacy.listGrievances())));
privacyAdminRoutes.patch(
  '/grievances/:id',
  validate({ params: z.object({ id: z.string().uuid() }), body: privacy.grievanceResponseInput }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await privacy.respondToGrievance(req.params.id!, req.body, user.id);
    await audit({ actorId: user.id, actorRole: user.role, action: `grievance.${req.body.status}`, entityType: 'privacy.grievance', entityId: req.params.id! });
    return ok(res, { status: req.body.status });
  }),
);
