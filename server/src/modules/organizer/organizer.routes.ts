import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentOrganizerId, currentUser, requireOrganizer } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { query, queryOne } from '../../db/pool';
import { asyncHandler, buildPageMeta, ok, paginated, sendCsv } from '../../utils/http';
import { csvFilename, toCsv } from '../../utils/csv';
import { paiseToRupees } from '../../utils/money';
import { NotFoundError } from '../../utils/errors';
import * as reportService from '../reports/report.service';
import * as ticketService from '../tickets/ticket.service';
import { assertEventOwnership } from '../events/event.service';

const router = Router();
router.use(authenticate, requireOrganizer);

/* ─────────────────────── profile ─────────────────────── */

router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const row = await queryOne(
      `SELECT o.id, o.display_name, o.slug, o.bio, o.logo_url, o.website, o.support_email, o.support_phone,
              o.gstin, o.pan, o.address, o.status, o.commission_percent, o.total_events, o.verified_at,
              o.rejection_reason, ci.id AS city_id, ci.name AS city_name
         FROM organizers o LEFT JOIN cities ci ON ci.id = o.city_id
        WHERE o.id = $1`,
      [organizerId],
    );
    if (!row) throw new NotFoundError('Organizer profile');
    return ok(res, {
      id: row.id,
      displayName: row.display_name,
      slug: row.slug,
      bio: row.bio,
      logoUrl: row.logo_url,
      website: row.website,
      supportEmail: row.support_email,
      supportPhone: row.support_phone,
      gstin: row.gstin,
      pan: row.pan,
      address: row.address,
      status: row.status,
      commissionPercent: row.commission_percent === null ? null : Number(row.commission_percent),
      totalEvents: Number(row.total_events),
      verifiedAt: row.verified_at,
      rejectionReason: row.rejection_reason,
      city: row.city_id ? { id: row.city_id, name: row.city_name } : null,
    });
  }),
);

router.patch(
  '/profile',
  validate({
    body: z.object({
      displayName: z.string().trim().min(2).max(120).optional(),
      bio: z.string().trim().max(2000).optional().nullable(),
      logoUrl: z.string().url().max(600).optional().nullable(),
      website: z.string().url().max(300).optional().nullable(),
      supportEmail: z.string().email().max(254).optional().nullable(),
      supportPhone: z.string().trim().max(20).optional().nullable(),
      gstin: z.string().trim().max(20).optional().nullable(),
      pan: z.string().trim().max(15).optional().nullable(),
      address: z.string().trim().max(500).optional().nullable(),
      cityId: z.string().uuid().optional().nullable(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const b = req.body;
    await query(
      `UPDATE organizers SET
         display_name  = COALESCE($2, display_name),
         bio           = COALESCE($3, bio),
         logo_url      = COALESCE($4, logo_url),
         website       = COALESCE($5, website),
         support_email = COALESCE($6, support_email),
         support_phone = COALESCE($7, support_phone),
         gstin         = COALESCE($8, gstin),
         pan           = COALESCE($9, pan),
         address       = COALESCE($10, address),
         city_id       = COALESCE($11, city_id)
       WHERE id = $1`,
      [
        organizerId,
        b.displayName ?? null,
        b.bio ?? null,
        b.logoUrl ?? null,
        b.website ?? null,
        b.supportEmail ?? null,
        b.supportPhone ?? null,
        b.gstin ?? null,
        b.pan ?? null,
        b.address ?? null,
        b.cityId ?? null,
      ],
    );
    return ok(res, { message: 'Profile updated' });
  }),
);

/* ─────────────────────── dashboard ─────────────────────── */

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const [summary, series, performance] = await Promise.all([
      reportService.getOrganizerSummary(organizerId),
      reportService.getOrganizerSalesSeries(organizerId, 30),
      reportService.getOrganizerEventPerformance(organizerId, 8),
    ]);
    return ok(res, { summary, salesSeries: series, events: performance });
  }),
);

router.get(
  '/reports',
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }) }),
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const days = Number((req.query as unknown as { days: number }).days);
    const [summary, series, performance] = await Promise.all([
      reportService.getOrganizerSummary(organizerId),
      reportService.getOrganizerSalesSeries(organizerId, days),
      reportService.getOrganizerEventPerformance(organizerId, 50),
    ]);
    return ok(res, { summary, salesSeries: series, events: performance });
  }),
);

/* ─────────────────────── bookings ─────────────────────── */

router.get(
  '/bookings',
  validate({
    query: z.object({
      eventId: z.string().uuid().optional(),
      status: z.string().max(30).optional(),
      q: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const params = req.query as unknown as {
      eventId?: string;
      status?: string;
      q?: string;
      page: number;
      limit: number;
    };

    const conditions = ['b.organizer_id = $1'];
    const values: unknown[] = [organizerId];

    if (params.eventId) {
      values.push(params.eventId);
      conditions.push(`b.event_id = $${values.length}`);
    }
    if (params.status) {
      values.push(params.status);
      conditions.push(`b.status = $${values.length}::booking_status`);
    }
    if (params.q) {
      values.push(params.q);
      conditions.push(
        `(b.booking_code ILIKE '%' || $${values.length} || '%'
          OR b.customer_name ILIKE '%' || $${values.length} || '%'
          OR b.customer_email ILIKE '%' || $${values.length} || '%')`,
      );
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (params.page - 1) * params.limit;
    values.push(params.limit, offset);

    const [list, count] = await Promise.all([
      query(
        `SELECT b.id, b.booking_code, b.status, b.quantity, b.total_paise, b.organizer_payout_paise,
                b.customer_name, b.customer_email, b.customer_phone, b.created_at, b.confirmed_at,
                e.title AS event_title, e.id AS event_id,
                (SELECT count(*)::int FROM tickets t WHERE t.booking_id = b.id AND t.status = 'used') AS checked_in
           FROM bookings b JOIN events e ON e.id = b.event_id
           ${where}
           ORDER BY b.created_at DESC
           LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
      query<{ total: number }>(
        `SELECT count(*)::int AS total FROM bookings b ${where}`,
        values.slice(0, values.length - 2),
      ),
    ]);

    return paginated(
      res,
      list.rows.map((row) => ({
        id: row.id,
        bookingCode: row.booking_code,
        status: row.status,
        quantity: Number(row.quantity),
        totalPaise: Number(row.total_paise),
        payoutPaise: Number(row.organizer_payout_paise),
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        customerPhone: row.customer_phone,
        createdAt: row.created_at,
        confirmedAt: row.confirmed_at,
        checkedIn: Number(row.checked_in),
        event: { id: row.event_id, title: row.event_title },
      })),
      buildPageMeta(params.page, params.limit, count.rows[0]?.total ?? 0),
    );
  }),
);

/** CSV export of attendees — the PRD's "Download CSV Report". */
router.get(
  '/bookings/export',
  validate({ query: z.object({ eventId: z.string().uuid().optional() }) }),
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const eventId = (req.query as unknown as { eventId?: string }).eventId;
    if (eventId) await assertEventOwnership(eventId, currentUser(req));

    const rows = await reportService.getAttendees({ organizerId, eventId });
    const csv = toCsv(rows, [
      { header: 'Booking ID', value: (r) => r.booking_code },
      { header: 'Ticket Code', value: (r) => r.ticket_code },
      { header: 'Event', value: (r) => r.event_title },
      { header: 'Attendee', value: (r) => r.attendee_name },
      { header: 'Email', value: (r) => r.customer_email },
      { header: 'Phone', value: (r) => r.customer_phone },
      { header: 'Ticket Type', value: (r) => r.ticket_type },
      { header: 'Price (INR)', value: (r) => paiseToRupees(Number(r.unit_price_paise)).toFixed(2) },
      { header: 'Booking Status', value: (r) => r.booking_status },
      { header: 'Ticket Status', value: (r) => r.ticket_status },
      { header: 'Checked In At', value: (r) => (r.checked_in_at ? r.checked_in_at.toISOString() : '') },
      { header: 'Booked At', value: (r) => r.booked_at.toISOString() },
    ]);

    return sendCsv(res, csvFilename('tixit-attendees'), csv);
  }),
);

/* ─────────────────────── QR check-in ─────────────────────── */

router.post(
  '/checkin',
  validate({
    body: z.object({
      payload: z.string().trim().min(4).max(300),
      eventId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await ticketService.checkInTicket(req.body.payload, currentUser(req), req.body.eventId);
    return ok(res, result);
  }),
);

router.post(
  '/checkin/lookup',
  validate({ body: z.object({ code: z.string().trim().min(4).max(300) }) }),
  asyncHandler(async (req, res) => {
    return ok(res, await ticketService.lookupTicket(req.body.code));
  }),
);

router.post(
  '/checkin/:ticketId/undo',
  validate({ params: z.object({ ticketId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await ticketService.undoCheckIn(req.params.ticketId, currentUser(req));
    return ok(res, { message: 'Check-in reversed' });
  }),
);

router.get(
  '/events/:id/checkin-stats',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await assertEventOwnership(req.params.id, currentUser(req));
    return ok(res, await ticketService.getCheckInStats(req.params.id));
  }),
);

export default router;
