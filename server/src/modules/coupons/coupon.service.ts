import type { PoolClient } from 'pg';
import { dbRunner, query } from '../../db/pool';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { percentOf } from '../../utils/money';

export interface CouponRow {
  id: string;
  code: string;
  type: 'percent' | 'flat';
  value: number;
  max_discount_paise: number | null;
  min_order_paise: number;
  usage_limit_total: number | null;
  usage_limit_per_user: number;
  used_count: number;
  valid_from: Date;
  valid_until: Date | null;
  event_id: string | null;
  organizer_id: string | null;
  is_active: boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
}

export interface CouponEvaluation {
  coupon: CouponRow;
  discountPaise: number;
}

/**
 * Validate a coupon against a specific cart and compute its discount.
 *
 * Runs inside the booking transaction with `FOR UPDATE` on the coupon row when
 * a client is supplied: without the lock, two concurrent checkouts could both
 * observe `used_count = 99` on a coupon limited to 100 and both succeed.
 */
export async function evaluateCoupon(options: {
  code: string;
  subtotalPaise: number;
  eventId: string;
  organizerId: string;
  /**
   * Absent for a signed-out shopper previewing a price. Every other rule still
   * applies; only the per-user redemption cap is deferred, because it cannot be
   * evaluated without an identity. It is re-checked with a real userId inside
   * the booking transaction, so a guest can never actually over-redeem.
   */
  userId?: string | null;
  client?: PoolClient;
}): Promise<CouponEvaluation> {
  const { code, subtotalPaise, eventId, organizerId, userId, client } = options;
  const runner = dbRunner(client);

  /*
   * `now()` is selected alongside the row so the validity window is judged
   * against the database's clock — the same clock that wrote valid_from.
   * Comparing a database timestamp to the application's Date.now() means any
   * skew between the two machines (a managed Postgres is rarely on the same
   * host) can make a just-created coupon look "not started yet".
   */
  const { rows } = await runner.query<CouponRow & { db_now: Date }>(
    `SELECT id, code, type, value, max_discount_paise, min_order_paise, usage_limit_total,
            usage_limit_per_user, used_count, valid_from, valid_until, event_id, organizer_id,
            is_active, approval_status, now() AS db_now
       FROM coupons
      WHERE upper(code) = upper($1)
      ${client ? 'FOR UPDATE' : ''}`,
    [code],
  );

  const coupon = rows[0];
  if (!coupon) throw new NotFoundError('Coupon', 'COUPON_NOT_FOUND');
  if (!coupon.is_active) throw new BadRequestError('This coupon is no longer active', 'COUPON_INACTIVE');
  // An organizer-created coupon is inert until an admin approves it. Reported
  // as "not found" so an unapproved code cannot be probed for existence.
  if (coupon.approval_status !== 'approved') {
    throw new NotFoundError('Coupon', 'COUPON_NOT_FOUND');
  }

  const now = coupon.db_now.getTime();
  if (coupon.valid_from.getTime() > now) {
    throw new BadRequestError('This coupon is not valid yet', 'COUPON_NOT_STARTED');
  }
  if (coupon.valid_until && coupon.valid_until.getTime() < now) {
    throw new BadRequestError('This coupon has expired', 'COUPON_EXPIRED');
  }

  // Scope: a coupon can be restricted to one event or one organizer.
  if (coupon.event_id && coupon.event_id !== eventId) {
    throw new BadRequestError('This coupon is not valid for this event', 'COUPON_WRONG_EVENT');
  }
  if (coupon.organizer_id && coupon.organizer_id !== organizerId) {
    throw new BadRequestError('This coupon is not valid for this organizer', 'COUPON_WRONG_ORGANIZER');
  }

  if (subtotalPaise < Number(coupon.min_order_paise)) {
    throw new BadRequestError(
      `Add ₹${((Number(coupon.min_order_paise) - subtotalPaise) / 100).toFixed(0)} more to use this coupon`,
      'COUPON_MIN_ORDER',
    );
  }

  if (coupon.usage_limit_total !== null && Number(coupon.used_count) >= Number(coupon.usage_limit_total)) {
    throw new BadRequestError('This coupon has been fully redeemed', 'COUPON_EXHAUSTED');
  }

  if (userId) {
    const { rows: usageRows } = await runner.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM coupon_redemptions cr
         JOIN bookings b ON b.id = cr.booking_id
        WHERE cr.coupon_id = $1 AND cr.user_id = $2
          AND b.status IN ('pending', 'confirmed', 'refunded', 'partially_refunded')`,
      [coupon.id, userId],
    );
    if ((usageRows[0]?.count ?? 0) >= Number(coupon.usage_limit_per_user)) {
      throw new BadRequestError('You have already used this coupon', 'COUPON_ALREADY_USED');
    }
  }

  return { coupon, discountPaise: computeDiscount(coupon, subtotalPaise) };
}

export interface PublicCoupon {
  code: string;
  description: string | null;
  type: 'percent' | 'flat';
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  validUntil: Date | null;
  /** Human-readable summary, e.g. "10% off, up to ₹500". */
  label: string;
}

/**
 * Coupons a shopper could actually use on this event right now.
 *
 * Nobody guesses a promo code, so requiring one to be typed from memory means
 * campaigns go unredeemed. This powers the "available offers" list at checkout.
 *
 * Only currently-valid, non-exhausted coupons scoped to this event, its
 * organizer, or the whole platform are returned. Per-user limits are
 * deliberately not applied here — that would leak whether a specific person had
 * already redeemed something, and the real check happens at booking time.
 */
export async function listAvailableCoupons(
  eventId: string,
  organizerId: string,
): Promise<PublicCoupon[]> {
  const { rows } = await query<CouponRow & { description: string | null }>(
    `SELECT code, description, type, value, max_discount_paise, min_order_paise,
            usage_limit_total, usage_limit_per_user, used_count, valid_from, valid_until,
            event_id, organizer_id, is_active, approval_status
       FROM coupons
      WHERE is_active = true
        AND approval_status = 'approved'
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())
        AND (usage_limit_total IS NULL OR used_count < usage_limit_total)
        AND (event_id IS NULL OR event_id = $1)
        AND (organizer_id IS NULL OR organizer_id = $2)
      ORDER BY
        -- Event-specific offers are the most relevant, then organizer, then platform-wide.
        (event_id IS NOT NULL) DESC,
        (organizer_id IS NOT NULL) DESC,
        min_order_paise ASC
      LIMIT 8`,
    [eventId, organizerId],
  );

  return rows.map((coupon) => ({
    code: coupon.code,
    description: coupon.description,
    type: coupon.type,
    value: Number(coupon.value),
    maxDiscountPaise: coupon.max_discount_paise === null ? null : Number(coupon.max_discount_paise),
    minOrderPaise: Number(coupon.min_order_paise),
    validUntil: coupon.valid_until,
    label: describeCoupon(coupon),
  }));
}

function describeCoupon(coupon: CouponRow): string {
  const parts: string[] = [];

  if (coupon.type === 'percent') {
    parts.push(`${Number(coupon.value)}% off`);
    if (coupon.max_discount_paise !== null) {
      parts.push(`up to ₹${Math.round(Number(coupon.max_discount_paise) / 100)}`);
    }
  } else {
    parts.push(`₹${Math.round(Number(coupon.value) / 100)} off`);
  }

  if (Number(coupon.min_order_paise) > 0) {
    parts.push(`on orders over ₹${Math.round(Number(coupon.min_order_paise) / 100)}`);
  }

  return parts.join(', ');
}

/** Discount never exceeds the order value, and honours max_discount_paise. */
export function computeDiscount(coupon: CouponRow, subtotalPaise: number): number {
  let discount =
    coupon.type === 'percent' ? percentOf(subtotalPaise, Number(coupon.value)) : Math.round(Number(coupon.value));

  if (coupon.max_discount_paise !== null) {
    discount = Math.min(discount, Number(coupon.max_discount_paise));
  }
  return Math.max(0, Math.min(discount, subtotalPaise));
}

/** Record the redemption and bump the counter. Must run in the booking transaction. */
export async function redeemCoupon(
  client: PoolClient,
  input: { couponId: string; bookingId: string; userId: string; discountPaise: number },
): Promise<void> {
  await client.query(
    `INSERT INTO coupon_redemptions (coupon_id, booking_id, user_id, discount_paise)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (booking_id) DO NOTHING`,
    [input.couponId, input.bookingId, input.userId, input.discountPaise],
  );
  await client.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [input.couponId]);
}

/** Release a coupon when its booking expires or is cancelled before payment. */
export async function releaseCoupon(client: PoolClient, bookingId: string): Promise<void> {
  const { rows } = await client.query<{ coupon_id: string }>(
    'DELETE FROM coupon_redemptions WHERE booking_id = $1 RETURNING coupon_id',
    [bookingId],
  );
  for (const row of rows) {
    await client.query('UPDATE coupons SET used_count = GREATEST(0, used_count - 1) WHERE id = $1', [row.coupon_id]);
  }
}
