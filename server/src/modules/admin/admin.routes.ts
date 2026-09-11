import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { query, queryOne, withTransaction } from '../../db/pool';
import { asyncHandler, buildPageMeta, clientIp, ok, paginated, sendCsv } from '../../utils/http';
import { csvFilename, toCsv } from '../../utils/csv';
import { paiseToRupees, rupeesToPaise } from '../../utils/money';
import { ConflictError, NotFoundError } from '../../utils/errors';
import { audit } from '../../services/audit.service';
import { sendMailAsync } from '../../services/mail.service';
import { getSettings, updateSettings } from '../../services/settings.service';
import { env } from '../../config/env';
import * as reportService from '../reports/report.service';
import * as payoutService from '../payouts/payout.service';
import * as kycService from '../payouts/kyc.service';
import { processRefund } from '../payments/payment.service';
import { cancelEvent } from '../events/event.service';
import { invalidateCache } from '../../utils/cache';

const router = Router();
router.use(authenticate, requireAdmin);

/** "1–31 Aug 2025", or empty when a payout covers no particular window. */
function periodLabel(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  if (start && end) return `${start} to ${end}`;
  return start ?? end ?? '';
}

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
});

/* ─────────────────────── dashboard & reports ─────────────────────── */

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [summary, revenue, topEvents, categories] = await Promise.all([
      reportService.getAdminSummary(),
      reportService.getAdminRevenueSeries(30),
      reportService.getTopEvents(8),
      reportService.getCategoryBreakdown(),
    ]);
    return ok(res, { summary, revenueSeries: revenue, topEvents, categories });
  }),
);

router.get(
  '/reports',
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }) }),
  asyncHandler(async (req, res) => {
    const days = Number((req.query as unknown as { days: number }).days);
    const [summary, revenue, topEvents, categories] = await Promise.all([
      reportService.getAdminSummary(),
      reportService.getAdminRevenueSeries(days),
      reportService.getTopEvents(20),
      reportService.getCategoryBreakdown(),
    ]);
    return ok(res, { summary, revenueSeries: revenue, topEvents, categories });
  }),
);

router.get(
  '/reports/export',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT b.booking_code, b.status, b.quantity, b.subtotal_paise, b.discount_paise, b.tax_paise,
              b.convenience_fee_paise, b.total_paise, b.commission_paise, b.organizer_payout_paise,
              b.refunded_paise, b.coupon_code, b.customer_email, b.created_at, b.confirmed_at,
              e.title AS event_title, o.display_name AS organizer
         FROM bookings b
         JOIN events e     ON e.id = b.event_id
         JOIN organizers o ON o.id = b.organizer_id
        ORDER BY b.created_at DESC
        LIMIT 20000`,
    );

    const csv = toCsv(rows, [
      { header: 'Booking ID', value: (r) => r.booking_code },
      { header: 'Event', value: (r) => r.event_title },
      { header: 'Organizer', value: (r) => r.organizer },
      { header: 'Customer', value: (r) => r.customer_email },
      { header: 'Status', value: (r) => r.status },
      { header: 'Qty', value: (r) => r.quantity },
      { header: 'Subtotal', value: (r) => paiseToRupees(Number(r.subtotal_paise)).toFixed(2) },
      { header: 'Discount', value: (r) => paiseToRupees(Number(r.discount_paise)).toFixed(2) },
      { header: 'Tax', value: (r) => paiseToRupees(Number(r.tax_paise)).toFixed(2) },
      { header: 'Convenience Fee', value: (r) => paiseToRupees(Number(r.convenience_fee_paise)).toFixed(2) },
      { header: 'Total', value: (r) => paiseToRupees(Number(r.total_paise)).toFixed(2) },
      { header: 'Commission', value: (r) => paiseToRupees(Number(r.commission_paise)).toFixed(2) },
      { header: 'Organizer Payout', value: (r) => paiseToRupees(Number(r.organizer_payout_paise)).toFixed(2) },
      { header: 'Refunded', value: (r) => paiseToRupees(Number(r.refunded_paise)).toFixed(2) },
      { header: 'Coupon', value: (r) => r.coupon_code ?? '' },
      { header: 'Created At', value: (r) => r.created_at },
      { header: 'Confirmed At', value: (r) => r.confirmed_at ?? '' },
    ]);

    return sendCsv(res, csvFilename('tixit-bookings'), csv);
  }),
);

/* ─────────────────────── event moderation ─────────────────────── */

router.get(
  '/events',
  validate({ query: pageQuery.extend({ status: z.string().max(30).optional() }) }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as { status?: string; q?: string; page: number; limit: number };
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.status) {
      values.push(params.status);
      conditions.push(`e.status = $${values.length}::event_status`);
    }
    if (params.q) {
      values.push(params.q);
      conditions.push(`(e.title ILIKE '%' || $${values.length} || '%' OR o.display_name ILIKE '%' || $${values.length} || '%')`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.limit;
    values.push(params.limit, offset);

    const [list, count] = await Promise.all([
      query(
        `SELECT e.id, e.title, e.slug, e.status, e.starts_at, e.is_featured, e.submitted_at, e.created_at,
                e.total_capacity, e.tickets_sold, e.min_price_paise, e.banner_url, e.rejection_reason,
                o.id AS organizer_id, o.display_name AS organizer_name, o.status AS organizer_status,
                c.name AS category_name, ci.name AS city_name
           FROM events e
           JOIN organizers o ON o.id = e.organizer_id
           JOIN categories c ON c.id = e.category_id
           JOIN cities ci    ON ci.id = e.city_id
           ${where}
           ORDER BY (e.status = 'pending_review') DESC, e.submitted_at DESC NULLS LAST, e.created_at DESC
           LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
      query<{ total: number }>(
        `SELECT count(*)::int AS total FROM events e JOIN organizers o ON o.id = e.organizer_id ${where}`,
        values.slice(0, values.length - 2),
      ),
    ]);

    return paginated(
      res,
      list.rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        status: row.status,
        startsAt: row.starts_at,
        isFeatured: row.is_featured,
        submittedAt: row.submitted_at,
        createdAt: row.created_at,
        capacity: Number(row.total_capacity),
        ticketsSold: Number(row.tickets_sold),
        minPricePaise: Number(row.min_price_paise),
        bannerUrl: row.banner_url,
        rejectionReason: row.rejection_reason,
        category: row.category_name,
        city: row.city_name,
        organizer: { id: row.organizer_id, name: row.organizer_name, status: row.organizer_status },
      })),
      buildPageMeta(params.page, params.limit, count.rows[0]?.total ?? 0),
    );
  }),
);

router.post(
  '/events/:id/approve',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const { rows } = await query<{ title: string; slug: string; organizer_email: string; organizer_name: string }>(
      `UPDATE events e
          SET status = 'published', approved_at = now(), approved_by = $2,
              published_at = COALESCE(e.published_at, now()), rejection_reason = NULL
        FROM organizers o, users u
        WHERE e.id = $1 AND o.id = e.organizer_id AND u.id = o.user_id
          AND e.status IN ('pending_review', 'rejected', 'paused')
        RETURNING e.title, e.slug, u.email AS organizer_email, u.full_name AS organizer_name`,
      [req.params.id, admin.id],
    );
    if (rows.length === 0) throw new ConflictError('This event is not awaiting approval', 'INVALID_TRANSITION');
    invalidateCache('events:');
    invalidateCache('catalog:');

    const event = rows[0]!;
    sendMailAsync({
      to: event.organizer_email,
      template: 'event_approved',
      data: {
        name: event.organizer_name,
        eventTitle: event.title,
        eventUrl: `${env.webBaseUrl}/events/${event.slug}`,
      },
      eventId: req.params.id,
    });

    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'event.approved',
      entityType: 'event',
      entityId: req.params.id,
      ip: clientIp(req),
    });
    return ok(res, { status: 'published' });
  }),
);

router.post(
  '/events/:id/reject',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ reason: z.string().trim().min(5, 'Explain what needs to change').max(500) }),
  }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const { rows } = await query<{ title: string; organizer_email: string; organizer_name: string }>(
      `UPDATE events e
          SET status = 'rejected', rejection_reason = $3, approved_by = $2
        FROM organizers o, users u
        WHERE e.id = $1 AND o.id = e.organizer_id AND u.id = o.user_id
          AND e.status = 'pending_review'
        RETURNING e.title, u.email AS organizer_email, u.full_name AS organizer_name`,
      [req.params.id, admin.id, req.body.reason],
    );
    if (rows.length === 0) throw new ConflictError('This event is not awaiting approval', 'INVALID_TRANSITION');
    invalidateCache('events:');
    invalidateCache('catalog:');

    const event = rows[0]!;
    sendMailAsync({
      to: event.organizer_email,
      template: 'event_rejected',
      data: { name: event.organizer_name, eventTitle: event.title, reason: req.body.reason },
      eventId: req.params.id,
    });

    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'event.rejected',
      entityType: 'event',
      entityId: req.params.id,
      metadata: { reason: req.body.reason },
      ip: clientIp(req),
    });
    return ok(res, { status: 'rejected' });
  }),
);

router.post(
  '/events/:id/feature',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ featured: z.boolean() }),
  }),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('UPDATE events SET is_featured = $2 WHERE id = $1', [
      req.params.id,
      req.body.featured,
    ]);
    if (!rowCount) throw new NotFoundError('Event');
    invalidateCache('events:');
    return ok(res, { isFeatured: req.body.featured });
  }),
);

router.post(
  '/events/:id/cancel',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ reason: z.string().trim().min(5).max(500) }),
  }),
  asyncHandler(async (req, res) => {
    await cancelEvent(req.params.id, req.body.reason);
    invalidateCache('events:');
    invalidateCache('catalog:');
    await audit({
      actorId: currentUser(req).id,
      actorRole: 'admin',
      action: 'event.cancelled',
      entityType: 'event',
      entityId: req.params.id,
      metadata: { reason: req.body.reason },
    });
    return ok(res, { status: 'cancelled' });
  }),
);

/* ─────────────────────── organizers ─────────────────────── */

router.get(
  '/organizers',
  validate({ query: pageQuery.extend({ status: z.string().max(20).optional() }) }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as { status?: string; q?: string; page: number; limit: number };
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.status) {
      values.push(params.status);
      conditions.push(`o.status = $${values.length}::organizer_status`);
    }
    if (params.q) {
      values.push(params.q);
      conditions.push(`(o.display_name ILIKE '%' || $${values.length} || '%' OR u.email ILIKE '%' || $${values.length} || '%')`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.limit;
    values.push(params.limit, offset);

    const [list, count] = await Promise.all([
      query(
        `SELECT o.id, o.display_name, o.slug, o.status, o.commission_percent, o.total_events,
                o.created_at, o.verified_at, o.logo_url, o.gstin, o.pan, o.rejection_reason,
                u.full_name, u.email, u.phone,
                ${kycService.KYC_STATUS_SQL} AS kyc_status,
                k.submitted_at AS kyc_submitted_at,
                (SELECT COALESCE(sum(b.total_paise), 0)::bigint FROM bookings b
                  WHERE b.organizer_id = o.id AND b.status IN ('confirmed','refunded','partially_refunded')) AS revenue
           FROM organizers o
           JOIN users u ON u.id = o.user_id
           LEFT JOIN organizer_kyc k ON k.organizer_id = o.id
           ${where}
           ORDER BY (o.status = 'pending') DESC, o.created_at DESC
           LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
      query<{ total: number }>(
        `SELECT count(*)::int AS total FROM organizers o JOIN users u ON u.id = o.user_id ${where}`,
        values.slice(0, values.length - 2),
      ),
    ]);

    return paginated(
      res,
      list.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        slug: row.slug,
        status: row.status,
        commissionPercent: row.commission_percent === null ? null : Number(row.commission_percent),
        totalEvents: Number(row.total_events),
        createdAt: row.created_at,
        verifiedAt: row.verified_at,
        logoUrl: row.logo_url,
        gstin: row.gstin,
        pan: row.pan,
        rejectionReason: row.rejection_reason,
        kycStatus: row.kyc_status,
        kycSubmittedAt: row.kyc_submitted_at,
        revenuePaise: Number(row.revenue),
        user: { fullName: row.full_name, email: row.email, phone: row.phone },
      })),
      buildPageMeta(params.page, params.limit, count.rows[0]?.total ?? 0),
    );
  }),
);

/**
 * Organizer analytics leaderboard — how every organizer on the platform is
 * performing, in one sortable table.
 */
router.get(
  '/organizers/analytics',
  validate({
    query: pageQuery.extend({
      status: z.enum(['pending', 'verified', 'rejected', 'suspended']).optional(),
      sort: z.enum(['revenue', 'commission', 'tickets', 'events', 'attendance', 'newest', 'name']).default('revenue'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as {
      status?: string;
      q?: string;
      sort: reportService.OrganizerSort;
      page: number;
      limit: number;
    };
    const { organizers, totals, total } = await reportService.getOrganizerAnalytics(params);
    return ok(res, { organizers, totals, meta: buildPageMeta(params.page, params.limit, total) });
  }),
);

/** The full report for a single organizer: profile, sales, events, support load. */
router.get(
  '/organizers/:id/analytics',
  validate({
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }),
  }),
  asyncHandler(async (req, res) => {
    const days = Number((req.query as unknown as { days: number }).days);
    const report = await reportService.getOrganizerAdminReport(req.params.id, days);
    if (!report) throw new NotFoundError('Organizer');
    return ok(res, report);
  }),
);

/** Every booking taken by one organizer, as CSV. */
router.get(
  '/organizers/:id/bookings/export',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const organizer = await queryOne<{ slug: string }>('SELECT slug FROM organizers WHERE id = $1', [req.params.id]);
    if (!organizer) throw new NotFoundError('Organizer');

    const { rows } = await query(
      `SELECT b.booking_code, b.status, b.quantity, b.subtotal_paise, b.discount_paise, b.tax_paise,
              b.convenience_fee_paise, b.total_paise, b.commission_paise, b.organizer_payout_paise,
              b.refunded_paise, b.coupon_code, b.customer_name, b.customer_email, b.customer_phone,
              b.created_at, b.confirmed_at, e.title AS event_title, e.starts_at
         FROM bookings b JOIN events e ON e.id = b.event_id
        WHERE b.organizer_id = $1
        ORDER BY b.created_at DESC
        LIMIT 20000`,
      [req.params.id],
    );

    const csv = toCsv(rows, [
      { header: 'Booking ID', value: (r) => r.booking_code },
      { header: 'Event', value: (r) => r.event_title },
      { header: 'Event Date', value: (r) => r.starts_at },
      { header: 'Customer', value: (r) => r.customer_name },
      { header: 'Email', value: (r) => r.customer_email },
      { header: 'Phone', value: (r) => r.customer_phone },
      { header: 'Status', value: (r) => r.status },
      { header: 'Qty', value: (r) => r.quantity },
      { header: 'Subtotal', value: (r) => paiseToRupees(Number(r.subtotal_paise)).toFixed(2) },
      { header: 'Discount', value: (r) => paiseToRupees(Number(r.discount_paise)).toFixed(2) },
      { header: 'Tax', value: (r) => paiseToRupees(Number(r.tax_paise)).toFixed(2) },
      { header: 'Convenience Fee', value: (r) => paiseToRupees(Number(r.convenience_fee_paise)).toFixed(2) },
      { header: 'Total', value: (r) => paiseToRupees(Number(r.total_paise)).toFixed(2) },
      { header: 'Commission', value: (r) => paiseToRupees(Number(r.commission_paise)).toFixed(2) },
      { header: 'Organizer Payout', value: (r) => paiseToRupees(Number(r.organizer_payout_paise)).toFixed(2) },
      { header: 'Refunded', value: (r) => paiseToRupees(Number(r.refunded_paise)).toFixed(2) },
      { header: 'Coupon', value: (r) => r.coupon_code ?? '' },
      { header: 'Created At', value: (r) => r.created_at },
      { header: 'Confirmed At', value: (r) => r.confirmed_at ?? '' },
    ]);

    return sendCsv(res, csvFilename(`tixit-${organizer.slug}-bookings`), csv);
  }),
);

/**
 * The one organizer review decision.
 *
 * Verification *is* KYC approval — there is no second gate — so approving here
 * is the admin signing off on the details the organizer submitted at signup,
 * and an organizer with nothing on file cannot be verified at all.
 */
async function reviewOrganizerRequest(
  req: Request,
  res: Response,
  decision: kycService.ReviewDecision,
  reason?: string,
) {
  const admin = currentUser(req);
  const result = await kycService.reviewOrganizer(req.params.id!, decision, admin.id, reason);

  if (decision === 'verified') {
    sendMailAsync({
      to: result.contactEmail,
      template: 'organizer_verified',
      data: { name: result.contactName, organizerName: result.organizerName },
    });
  } else if (decision === 'rejected') {
    sendMailAsync({
      to: result.contactEmail,
      template: 'organizer_rejected',
      data: {
        name: result.contactName,
        organizerName: result.organizerName,
        reason: reason ?? 'Some of the details you submitted could not be verified.',
      },
    });
  }

  await audit({
    actorId: admin.id,
    actorRole: 'admin',
    action: `organizer.${decision}`,
    entityType: 'organizer',
    entityId: req.params.id,
    metadata: { reason, viaKyc: result.kyc !== null },
    ip: clientIp(req),
  });
  return ok(res, result);
}

router.post(
  '/organizers/:id/verify',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => reviewOrganizerRequest(req, res, 'verified')),
);

router.post(
  '/organizers/:id/status',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      status: z.enum(['pending', 'verified', 'rejected', 'suspended']),
      reason: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (req.body.status === 'rejected' && (req.body.reason ?? '').trim().length < 5) {
      throw new ConflictError('Tell the organizer what needs fixing', 'REASON_REQUIRED');
    }
    return reviewOrganizerRequest(req, res, req.body.status, req.body.reason);
  }),
);

/** Per-organizer commission override; null restores the platform default. */
router.post(
  '/organizers/:id/commission',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ commissionPercent: z.coerce.number().min(0).max(100).nullable() }),
  }),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('UPDATE organizers SET commission_percent = $2 WHERE id = $1', [
      req.params.id,
      req.body.commissionPercent,
    ]);
    if (!rowCount) throw new NotFoundError('Organizer');
    return ok(res, { commissionPercent: req.body.commissionPercent });
  }),
);

/* ─────────────────────── users ─────────────────────── */

router.get(
  '/users',
  validate({ query: pageQuery.extend({ role: z.enum(['admin', 'organizer', 'customer']).optional(), status: z.string().max(20).optional() }) }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as { role?: string; status?: string; q?: string; page: number; limit: number };
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.role) {
      values.push(params.role);
      conditions.push(`u.role = $${values.length}::user_role`);
    }
    if (params.status) {
      values.push(params.status);
      conditions.push(`u.status = $${values.length}::user_status`);
    }
    if (params.q) {
      values.push(params.q);
      conditions.push(`(u.full_name ILIKE '%' || $${values.length} || '%' OR u.email ILIKE '%' || $${values.length} || '%')`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.limit;
    values.push(params.limit, offset);

    const [list, count] = await Promise.all([
      query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.created_at, u.last_login_at,
                u.email_verified_at,
                (SELECT count(*)::int FROM bookings b WHERE b.user_id = u.id) AS bookings
           FROM users u ${where}
           ORDER BY u.created_at DESC
           LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
      query<{ total: number }>(`SELECT count(*)::int AS total FROM users u ${where}`, values.slice(0, values.length - 2)),
    ]);

    return paginated(
      res,
      list.rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        emailVerified: row.email_verified_at !== null,
        bookings: Number(row.bookings),
      })),
      buildPageMeta(params.page, params.limit, count.rows[0]?.total ?? 0),
    );
  }),
);

router.post(
  '/users/:id/status',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ status: z.enum(['active', 'suspended']) }),
  }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    // Guard rail: an admin locking themselves out is a support incident.
    if (admin.id === req.params.id) {
      throw new ConflictError('You cannot change your own account status', 'SELF_MODIFICATION');
    }
    const { rowCount } = await query('UPDATE users SET status = $2::user_status WHERE id = $1', [
      req.params.id,
      req.body.status,
    ]);
    if (!rowCount) throw new NotFoundError('User');

    // A suspended user's live sessions must die immediately.
    if (req.body.status === 'suspended') {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
        req.params.id,
      ]);
    }

    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: `user.${req.body.status}`,
      entityType: 'user',
      entityId: req.params.id,
    });
    return ok(res, { status: req.body.status });
  }),
);

/* ─────────────────────── coupons ─────────────────────── */

const couponBodySchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, hyphen or underscore'),
  description: z.string().trim().max(300).optional().nullable(),
  type: z.enum(['percent', 'flat']),
  /** percent → 1-100, flat → rupees (converted to paise on write). */
  value: z.coerce.number().positive(),
  maxDiscount: z.coerce.number().positive().optional().nullable(),
  minOrder: z.coerce.number().min(0).default(0),
  usageLimitTotal: z.coerce.number().int().positive().optional().nullable(),
  usageLimitPerUser: z.coerce.number().int().positive().default(1),
  validFrom: z.string().datetime({ offset: true }).optional(),
  validUntil: z.string().datetime({ offset: true }).optional().nullable(),
  eventId: z.string().uuid().optional().nullable(),
  organizerId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
});

router.get(
  '/coupons',
  validate({ query: pageQuery.extend({ approval: z.enum(['pending', 'approved', 'rejected']).optional() }) }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as { q?: string; approval?: string; page: number; limit: number };
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.q) {
      values.push(params.q);
      conditions.push(`c.code ILIKE '%' || $${values.length} || '%'`);
    }
    if (params.approval) {
      values.push(params.approval);
      conditions.push(`c.approval_status = $${values.length}::coupon_approval`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const offset = (params.page - 1) * params.limit;
    values.push(params.limit, offset);

    const [list, count] = await Promise.all([
      query(
        `SELECT c.*, e.title AS event_title, o.display_name AS organizer_name,
                (c.created_by_organizer IS NOT NULL) AS from_organizer
           FROM coupons c
           LEFT JOIN events e     ON e.id = c.event_id
           LEFT JOIN organizers o ON o.id = c.organizer_id
           ${where}
           ORDER BY (c.approval_status = 'pending') DESC, c.created_at DESC
           LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
      query<{ total: number }>(`SELECT count(*)::int AS total FROM coupons c ${where}`, values.slice(0, values.length - 2)),
    ]);

    return paginated(
      res,
      list.rows.map((row) => ({
        id: row.id,
        code: row.code,
        description: row.description,
        type: row.type,
        value: Number(row.value),
        maxDiscountPaise: row.max_discount_paise === null ? null : Number(row.max_discount_paise),
        minOrderPaise: Number(row.min_order_paise),
        usageLimitTotal: row.usage_limit_total === null ? null : Number(row.usage_limit_total),
        usageLimitPerUser: Number(row.usage_limit_per_user),
        usedCount: Number(row.used_count),
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        isActive: row.is_active,
        approvalStatus: row.approval_status,
        fromOrganizer: row.from_organizer,
        reviewNote: row.review_note,
        eventTitle: row.event_title,
        organizerName: row.organizer_name,
        createdAt: row.created_at,
      })),
      buildPageMeta(params.page, params.limit, count.rows[0]?.total ?? 0),
    );
  }),
);

router.post(
  '/coupons',
  validate({ body: couponBodySchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof couponBodySchema>;
    if (b.type === 'percent' && b.value > 100) {
      throw new ConflictError('A percentage discount cannot exceed 100', 'INVALID_PERCENT');
    }

    const { rows } = await query<{ id: string }>(
      `INSERT INTO coupons (code, description, type, value, max_discount_paise, min_order_paise,
                            usage_limit_total, usage_limit_per_user, valid_from, valid_until,
                            event_id, organizer_id, created_by, is_active)
       VALUES ($1,$2,$3::coupon_type,$4,$5,$6,$7,$8,COALESCE($9, now()),$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        b.code.toUpperCase(),
        b.description ?? null,
        b.type,
        // A flat discount is entered in rupees but stored in paise, like all money.
        b.type === 'flat' ? rupeesToPaise(b.value) : b.value,
        b.maxDiscount ? rupeesToPaise(b.maxDiscount) : null,
        rupeesToPaise(b.minOrder),
        b.usageLimitTotal ?? null,
        b.usageLimitPerUser,
        b.validFrom ? new Date(b.validFrom) : null,
        b.validUntil ? new Date(b.validUntil) : null,
        b.eventId ?? null,
        b.organizerId ?? null,
        currentUser(req).id,
        b.isActive,
      ],
    );
    return ok(res, rows[0], 201);
  }),
);

router.patch(
  '/coupons/:id',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: couponBodySchema.partial(),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body as Partial<z.infer<typeof couponBodySchema>>;
    const { rowCount } = await query(
      `UPDATE coupons SET
         description          = COALESCE($2, description),
         value                = COALESCE($3, value),
         max_discount_paise   = COALESCE($4, max_discount_paise),
         min_order_paise      = COALESCE($5, min_order_paise),
         usage_limit_total    = COALESCE($6, usage_limit_total),
         usage_limit_per_user = COALESCE($7, usage_limit_per_user),
         valid_until          = COALESCE($8, valid_until),
         is_active            = COALESCE($9, is_active)
       WHERE id = $1`,
      [
        req.params.id,
        b.description ?? null,
        // A flat value arrives in rupees; a percent value is stored as-is.
        b.value !== undefined ? (b.type === 'flat' ? rupeesToPaise(b.value) : b.value) : null,
        b.maxDiscount != null ? rupeesToPaise(b.maxDiscount) : null,
        b.minOrder !== undefined ? rupeesToPaise(b.minOrder) : null,
        b.usageLimitTotal ?? null,
        b.usageLimitPerUser ?? null,
        b.validUntil ? new Date(b.validUntil) : null,
        b.isActive ?? null,
      ],
    );
    if (!rowCount) throw new NotFoundError('Coupon');
    return ok(res, { message: 'Coupon updated' });
  }),
);

router.delete(
  '/coupons/:id',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM coupons WHERE id = $1', [req.params.id]);
    if (!rowCount) throw new NotFoundError('Coupon');
    return ok(res, { message: 'Coupon deleted' });
  }),
);

/**
 * Approve an organizer's coupon. Only after this can a customer redeem it.
 */
router.post(
  '/coupons/:id/approve',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ note: z.string().trim().max(500).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const { rowCount } = await query(
      `UPDATE coupons
          SET approval_status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = $3
        WHERE id = $1 AND approval_status = 'pending'`,
      [req.params.id, admin.id, req.body.note ?? null],
    );
    if (!rowCount) throw new ConflictError('This coupon is not awaiting review', 'INVALID_TRANSITION');

    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'coupon.approved',
      entityType: 'coupon',
      entityId: req.params.id,
    });
    return ok(res, { approvalStatus: 'approved' });
  }),
);

router.post(
  '/coupons/:id/reject',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ note: z.string().trim().min(3, 'Tell the organizer why').max(500) }),
  }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const { rowCount } = await query(
      `UPDATE coupons
          SET approval_status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
        WHERE id = $1 AND approval_status = 'pending'`,
      [req.params.id, admin.id, req.body.note],
    );
    if (!rowCount) throw new ConflictError('This coupon is not awaiting review', 'INVALID_TRANSITION');

    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'coupon.rejected',
      entityType: 'coupon',
      entityId: req.params.id,
      metadata: { note: req.body.note },
    });
    return ok(res, { approvalStatus: 'rejected' });
  }),
);

/* ─────────────────────── refunds ─────────────────────── */

router.get(
  '/refunds',
  validate({ query: pageQuery.extend({ status: z.string().max(20).optional() }) }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as { status?: string; page: number; limit: number };
    const values: unknown[] = [];
    let where = '';
    if (params.status) {
      values.push(params.status);
      where = `WHERE r.status = $1::refund_status`;
    }
    const offset = (params.page - 1) * params.limit;
    values.push(params.limit, offset);

    const [list, count] = await Promise.all([
      query(
        `SELECT r.id, r.amount_paise, r.reason, r.status, r.admin_note, r.created_at, r.reviewed_at, r.processed_at,
                b.id AS booking_id, b.booking_code, b.customer_name, b.customer_email, b.total_paise,
                e.title AS event_title
           FROM refunds r
           JOIN bookings b ON b.id = r.booking_id
           JOIN events e   ON e.id = b.event_id
           ${where}
           ORDER BY (r.status = 'requested') DESC, r.created_at DESC
           LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
      query<{ total: number }>(`SELECT count(*)::int AS total FROM refunds r ${where}`, values.slice(0, values.length - 2)),
    ]);

    return paginated(
      res,
      list.rows.map((row) => ({
        id: row.id,
        amountPaise: Number(row.amount_paise),
        reason: row.reason,
        status: row.status,
        adminNote: row.admin_note,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        processedAt: row.processed_at,
        booking: {
          id: row.booking_id,
          code: row.booking_code,
          customerName: row.customer_name,
          customerEmail: row.customer_email,
          totalPaise: Number(row.total_paise),
        },
        eventTitle: row.event_title,
      })),
      buildPageMeta(params.page, params.limit, count.rows[0]?.total ?? 0),
    );
  }),
);

/**
 * Approve a refund and immediately execute it against the gateway.
 * Approval and execution are one admin action so money cannot sit in an
 * "approved but never paid" limbo.
 */
router.post(
  '/refunds/:id/approve',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ note: z.string().trim().max(500).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const { rowCount } = await query(
      `UPDATE refunds SET status = 'approved', reviewed_by = $2, reviewed_at = now(), admin_note = $3
        WHERE id = $1 AND status = 'requested'`,
      [req.params.id, admin.id, req.body.note ?? null],
    );
    if (!rowCount) throw new ConflictError('This refund is not awaiting review', 'INVALID_TRANSITION');

    const result = await processRefund(req.params.id);
    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'refund.approved',
      entityType: 'refund',
      entityId: req.params.id,
    });
    return ok(res, result);
  }),
);

router.post(
  '/refunds/:id/reject',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ note: z.string().trim().min(3).max(500) }),
  }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const { rowCount } = await query(
      `UPDATE refunds SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), admin_note = $3
        WHERE id = $1 AND status = 'requested'`,
      [req.params.id, admin.id, req.body.note],
    );
    if (!rowCount) throw new ConflictError('This refund is not awaiting review', 'INVALID_TRANSITION');
    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'refund.rejected',
      entityType: 'refund',
      entityId: req.params.id,
    });
    return ok(res, { status: 'rejected' });
  }),
);

/* ─────────────────────── organizer payments ─────────────────────── */

/**
 * The payouts index: every organizer with what they have earned, what has been
 * sent and what is still owed, so finance can work down the list by balance.
 */
router.get(
  '/payouts',
  validate({
    query: pageQuery.extend({
      kycStatus: z.enum(['not_submitted', 'pending', 'approved', 'rejected']).optional(),
      // Not z.coerce.boolean(), which reads the string "false" as true.
      owing: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true'),
      sort: z.enum(['pending', 'revenue', 'paid', 'name']).default('pending'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as {
      q?: string;
      kycStatus?: string;
      owing?: boolean;
      sort: string;
      page: number;
      limit: number;
    };
    const { organizers, totals, total } = await payoutService.getOrganizerLedger(params);
    return ok(res, { organizers, totals, meta: buildPageMeta(params.page, params.limit, total) });
  }),
);

/**
 * Everything about one organizer's money on a single screen: their KYC and
 * bank details, the balance, the payout ledger and per-event earnings.
 */
router.get(
  '/organizers/:id/payments',
  validate({
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      status: z.enum(payoutService.PAYOUT_STATUSES).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as { status?: string; page: number; limit: number };
    const organizer = await queryOne(
      `SELECT o.id, o.display_name, o.slug, o.status, o.logo_url, o.commission_percent, o.created_at,
              u.full_name, u.email, u.phone
         FROM organizers o JOIN users u ON u.id = o.user_id
        WHERE o.id = $1`,
      [req.params.id],
    );
    if (!organizer) throw new NotFoundError('Organizer');

    const [kyc, summary, ledger, events] = await Promise.all([
      kycService.getKycState(req.params.id),
      payoutService.getPayoutSummary(req.params.id),
      payoutService.listPayouts(req.params.id, params),
      payoutService.getEventEarnings(req.params.id),
    ]);

    return ok(res, {
      organizer: {
        id: organizer.id,
        displayName: organizer.display_name,
        slug: organizer.slug,
        status: organizer.status,
        logoUrl: organizer.logo_url,
        commissionPercent: organizer.commission_percent === null ? null : Number(organizer.commission_percent),
        createdAt: organizer.created_at,
        user: { fullName: organizer.full_name, email: organizer.email, phone: organizer.phone },
      },
      kyc,
      summary,
      payouts: ledger.payouts,
      events,
      meta: buildPageMeta(params.page, params.limit, ledger.total),
    });
  }),
);

/** Record a transfer the finance team has made. */
router.post(
  '/organizers/:id/payouts',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: payoutService.PAYOUT_INPUT,
  }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const payout = await payoutService.createPayout(req.params.id, req.body, admin.id);

    if (payout.status === 'paid') {
      const contact = await queryOne<{ email: string; full_name: string; display_name: string }>(
        `SELECT u.email, u.full_name, o.display_name
           FROM organizers o JOIN users u ON u.id = o.user_id
          WHERE o.id = $1`,
        [req.params.id],
      );
      if (contact) {
        sendMailAsync({
          to: contact.email,
          template: 'payout_sent',
          data: {
            name: contact.full_name,
            organizerName: contact.display_name,
            reference: payout.reference,
            amountPaise: payout.netPaise,
            method: payout.method.replace(/_/g, ' '),
            utr: payout.utr,
            periodLabel: periodLabel(payout.periodStart, payout.periodEnd),
          },
        });
      }
    }

    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'organizer.payout.recorded',
      entityType: 'organizer_payout',
      entityId: payout.id,
      metadata: {
        organizerId: req.params.id,
        reference: payout.reference,
        amountPaise: payout.amountPaise,
        status: payout.status,
      },
      ip: clientIp(req),
    });
    return ok(res, payout, 201);
  }),
);

/** Correct a recorded payout — a mistyped UTR, a transfer that later failed. */
router.patch(
  '/payouts/:payoutId',
  validate({
    params: z.object({ payoutId: z.string().uuid() }),
    body: payoutService.PAYOUT_PATCH,
  }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const payout = await payoutService.updatePayout(req.params.payoutId, req.body);
    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'organizer.payout.updated',
      entityType: 'organizer_payout',
      entityId: payout.id,
      metadata: { organizerId: payout.organizerId, changes: req.body },
      ip: clientIp(req),
    });
    return ok(res, payout);
  }),
);

router.delete(
  '/payouts/:payoutId',
  validate({ params: z.object({ payoutId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const removed = await payoutService.deletePayout(req.params.payoutId);
    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'organizer.payout.deleted',
      entityType: 'organizer_payout',
      entityId: req.params.payoutId,
      metadata: removed,
      ip: clientIp(req),
    });
    return ok(res, { deleted: true, reference: removed.reference });
  }),
);

/** The payout ledger for one organizer, as CSV, for the accounts team. */
router.get(
  '/organizers/:id/payouts/export',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const organizer = await queryOne<{ slug: string }>('SELECT slug FROM organizers WHERE id = $1', [req.params.id]);
    if (!organizer) throw new NotFoundError('Organizer');

    const { payouts } = await payoutService.listPayouts(req.params.id, { limit: 5000 });
    const csv = toCsv(payouts, [
      { header: 'Reference', value: (r) => r.reference },
      { header: 'Status', value: (r) => r.status },
      { header: 'Method', value: (r) => r.method },
      { header: 'Amount', value: (r) => paiseToRupees(r.amountPaise).toFixed(2) },
      { header: 'TDS', value: (r) => paiseToRupees(r.tdsPaise).toFixed(2) },
      { header: 'Charges', value: (r) => paiseToRupees(r.feePaise).toFixed(2) },
      { header: 'Net Transferred', value: (r) => paiseToRupees(r.netPaise).toFixed(2) },
      { header: 'UTR', value: (r) => r.utr ?? '' },
      { header: 'Period Start', value: (r) => r.periodStart ?? '' },
      { header: 'Period End', value: (r) => r.periodEnd ?? '' },
      { header: 'Destination', value: (r) => r.destination ?? '' },
      { header: 'Paid At', value: (r) => (r.paidAt ? r.paidAt.toISOString() : '') },
      { header: 'Recorded By', value: (r) => r.createdBy?.fullName ?? '' },
      { header: 'Recorded At', value: (r) => r.createdAt.toISOString() },
      { header: 'Notes', value: (r) => r.notes ?? '' },
    ]);

    return sendCsv(res, csvFilename(`tixit-${organizer.slug}-payouts`), csv);
  }),
);

/* ─────────────────────── settings ─────────────────────── */

router.get(
  '/settings',
  asyncHandler(async (_req, res) => ok(res, await getSettings())),
);

router.patch(
  '/settings',
  validate({
    body: z.object({
      commission_percent: z.coerce.number().min(0).max(100).optional(),
      tax_percent: z.coerce.number().min(0).max(100).optional(),
      convenience_fee_percent: z.coerce.number().min(0).max(100).optional(),
      booking_hold_minutes: z.coerce.number().int().min(1).max(1440).optional(),
      refund_window_hours: z.coerce.number().int().min(0).max(8760).optional(),
      support_email: z.string().email().optional(),
      platform_name: z.string().trim().min(1).max(60).optional(),
      auto_approve_events: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const updated = await updateSettings(req.body, admin.id);
    await audit({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'settings.updated',
      entityType: 'settings',
      metadata: req.body,
    });
    return ok(res, updated);
  }),
);

/* ─────────────────────── audit trail ─────────────────────── */

router.get(
  '/audit-logs',
  validate({ query: pageQuery }),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as { page: number; limit: number };
    const offset = (params.page - 1) * params.limit;
    const [list, count] = await Promise.all([
      query(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at, a.ip,
                u.full_name AS actor_name, u.email AS actor_email, a.actor_role
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
          ORDER BY a.created_at DESC
          LIMIT $1 OFFSET $2`,
        [params.limit, offset],
      ),
      queryOne<{ total: number }>('SELECT count(*)::int AS total FROM audit_logs'),
    ]);

    return paginated(
      res,
      list.rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metadata: row.metadata,
        createdAt: row.created_at,
        ip: row.ip,
        actor: { name: row.actor_name, email: row.actor_email, role: row.actor_role },
      })),
      buildPageMeta(params.page, params.limit, count?.total ?? 0),
    );
  }),
);

export default router;

// Re-exported for tests that need a transaction-scoped helper.
export { withTransaction };
