import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentOrganizerId, currentUser, requireOrganizer } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { query, queryOne } from '../../db/pool';
import { asyncHandler, buildPageMeta, ok, paginated } from '../../utils/http';
import { rupeesToPaise } from '../../utils/money';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors';
import { audit } from '../../services/audit.service';

/**
 * Coupons an organizer creates for their own events.
 *
 * Two invariants hold no matter what the client sends:
 *   1. `organizer_id` and `created_by_organizer` are always forced to the
 *      caller — never read from the request body — so an organizer cannot
 *      create a coupon that applies to a competitor's event.
 *   2. Anything they create or materially change lands in `pending` and stays
 *      inert until an admin approves it.
 */
const router = Router();
router.use(authenticate, requireOrganizer);

const couponBody = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, hyphen or underscore only'),
  description: z.string().trim().max(300).optional().nullable(),
  type: z.enum(['percent', 'flat']),
  /** percent → 1-100; flat → rupees, converted to paise on write. */
  value: z.coerce.number().positive(),
  maxDiscount: z.coerce.number().positive().optional().nullable(),
  minOrder: z.coerce.number().min(0).default(0),
  usageLimitTotal: z.coerce.number().int().positive().optional().nullable(),
  usageLimitPerUser: z.coerce.number().int().positive().default(1),
  validUntil: z.string().datetime({ offset: true }).optional().nullable(),
  /** Restrict to one of the organizer's events; omit to cover all of theirs. */
  eventId: z.string().uuid().optional().nullable(),
});

/** Reject an event that is not the caller's before it reaches the database. */
async function assertOwnsEvent(eventId: string | null | undefined, organizerId: string): Promise<void> {
  if (!eventId) return;
  const event = await queryOne<{ id: string }>('SELECT id FROM events WHERE id = $1 AND organizer_id = $2', [
    eventId,
    organizerId,
  ]);
  if (!event) throw new ForbiddenError('That event belongs to another organizer', 'NOT_YOUR_EVENT');
}

function validateDiscount(type: 'percent' | 'flat', value: number): void {
  if (type === 'percent' && value > 100) {
    throw new BadRequestError('A percentage discount cannot exceed 100', 'INVALID_PERCENT');
  }
}

/* ─────────────────────────── list ─────────────────────────── */

router.get(
  '/',
  validate({
    query: z.object({
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const params = req.query as unknown as { status?: string; page: number; limit: number };

    const values: unknown[] = [organizerId];
    let where = 'WHERE c.created_by_organizer = $1';
    if (params.status) {
      values.push(params.status);
      where += ` AND c.approval_status = $${values.length}::coupon_approval`;
    }

    const offset = (params.page - 1) * params.limit;
    values.push(params.limit, offset);

    const [list, count] = await Promise.all([
      query(
        `SELECT c.*, e.title AS event_title
           FROM coupons c
           LEFT JOIN events e ON e.id = c.event_id
           ${where}
           ORDER BY (c.approval_status = 'pending') DESC, c.created_at DESC
           LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
      query<{ total: number }>(
        `SELECT count(*)::int AS total FROM coupons c ${where}`,
        values.slice(0, values.length - 2),
      ),
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
        reviewNote: row.review_note,
        reviewedAt: row.reviewed_at,
        eventId: row.event_id,
        eventTitle: row.event_title,
        createdAt: row.created_at,
      })),
      buildPageMeta(params.page, params.limit, count.rows[0]?.total ?? 0),
    );
  }),
);

/* ────────────────────────── create ────────────────────────── */

router.post(
  '/',
  validate({ body: couponBody }),
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const b = req.body as z.infer<typeof couponBody>;

    validateDiscount(b.type, b.value);
    await assertOwnsEvent(b.eventId, organizerId);

    const existing = await queryOne<{ id: string }>('SELECT id FROM coupons WHERE upper(code) = upper($1)', [b.code]);
    if (existing) throw new ConflictError('That coupon code is already taken', 'CODE_TAKEN');

    const { rows } = await query<{ id: string; approval_status: string }>(
      `INSERT INTO coupons (code, description, type, value, max_discount_paise, min_order_paise,
                            usage_limit_total, usage_limit_per_user, valid_until,
                            event_id, organizer_id, created_by_organizer, created_by,
                            is_active, approval_status)
       VALUES ($1,$2,$3::coupon_type,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,true,'pending')
       RETURNING id, approval_status`,
      [
        b.code.toUpperCase(),
        b.description ?? null,
        b.type,
        b.type === 'flat' ? rupeesToPaise(b.value) : b.value,
        b.maxDiscount ? rupeesToPaise(b.maxDiscount) : null,
        rupeesToPaise(b.minOrder),
        b.usageLimitTotal ?? null,
        b.usageLimitPerUser,
        b.validUntil ? new Date(b.validUntil) : null,
        b.eventId ?? null,
        organizerId,
        currentUser(req).id,
      ],
    );

    await audit({
      actorId: currentUser(req).id,
      actorRole: currentUser(req).role,
      action: 'coupon.submitted',
      entityType: 'coupon',
      entityId: rows[0]!.id,
      metadata: { code: b.code.toUpperCase() },
    });

    return ok(
      res,
      {
        ...rows[0],
        message: 'Coupon submitted. It goes live once our team approves it.',
      },
      201,
    );
  }),
);

/* ────────────────────────── update ────────────────────────── */

router.patch(
  '/:id',
  validate({ params: z.object({ id: z.string().uuid() }), body: couponBody.partial() }),
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const b = req.body as Partial<z.infer<typeof couponBody>>;

    const existing = await queryOne<{ id: string; type: 'percent' | 'flat'; used_count: number }>(
      'SELECT id, type, used_count FROM coupons WHERE id = $1 AND created_by_organizer = $2',
      [req.params.id, organizerId],
    );
    if (!existing) throw new NotFoundError('Coupon');

    const type = b.type ?? existing.type;
    if (b.value !== undefined) validateDiscount(type, b.value);
    await assertOwnsEvent(b.eventId, organizerId);

    /*
     * Editing the money terms re-opens review — otherwise an organizer could
     * get a modest coupon approved and then quietly raise it to 90% off.
     * Cosmetic edits (description, switching it off) do not re-queue it.
     */
    const materialChange =
      b.value !== undefined ||
      b.type !== undefined ||
      b.maxDiscount !== undefined ||
      b.minOrder !== undefined ||
      b.usageLimitTotal !== undefined ||
      b.usageLimitPerUser !== undefined ||
      b.eventId !== undefined;

    await query(
      `UPDATE coupons SET
         description          = COALESCE($3, description),
         type                 = COALESCE($4::coupon_type, type),
         value                = COALESCE($5, value),
         max_discount_paise   = COALESCE($6, max_discount_paise),
         min_order_paise      = COALESCE($7, min_order_paise),
         usage_limit_total    = COALESCE($8, usage_limit_total),
         usage_limit_per_user = COALESCE($9, usage_limit_per_user),
         valid_until          = COALESCE($10, valid_until),
         event_id             = COALESCE($11, event_id),
         approval_status      = CASE WHEN $12 THEN 'pending'::coupon_approval ELSE approval_status END,
         review_note          = CASE WHEN $12 THEN NULL ELSE review_note END
       WHERE id = $1 AND created_by_organizer = $2`,
      [
        req.params.id,
        organizerId,
        b.description ?? null,
        b.type ?? null,
        b.value !== undefined ? (type === 'flat' ? rupeesToPaise(b.value) : b.value) : null,
        b.maxDiscount != null ? rupeesToPaise(b.maxDiscount) : null,
        b.minOrder !== undefined ? rupeesToPaise(b.minOrder) : null,
        b.usageLimitTotal ?? null,
        b.usageLimitPerUser ?? null,
        b.validUntil ? new Date(b.validUntil) : null,
        b.eventId ?? null,
        materialChange,
      ],
    );

    return ok(res, {
      message: materialChange
        ? 'Coupon updated and resubmitted for approval.'
        : 'Coupon updated.',
      requiresApproval: materialChange,
    });
  }),
);

/* ───────────────── activate / deactivate ───────────────── */

router.post(
  '/:id/toggle',
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ isActive: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      'UPDATE coupons SET is_active = $3 WHERE id = $1 AND created_by_organizer = $2',
      [req.params.id, currentOrganizerId(req), req.body.isActive],
    );
    if (!rowCount) throw new NotFoundError('Coupon');
    return ok(res, { isActive: req.body.isActive });
  }),
);

/* ────────────────────────── delete ────────────────────────── */

router.delete(
  '/:id',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const coupon = await queryOne<{ used_count: number }>(
      'SELECT used_count FROM coupons WHERE id = $1 AND created_by_organizer = $2',
      [req.params.id, currentOrganizerId(req)],
    );
    if (!coupon) throw new NotFoundError('Coupon');

    // Deleting would cascade the redemption rows and corrupt past bookings'
    // financial history, so a used coupon can only be switched off.
    if (Number(coupon.used_count) > 0) {
      throw new ConflictError(
        'This coupon has already been used. Deactivate it instead of deleting.',
        'COUPON_IN_USE',
      );
    }

    await query('DELETE FROM coupons WHERE id = $1', [req.params.id]);
    return ok(res, { message: 'Coupon deleted' });
  }),
);

export default router;
