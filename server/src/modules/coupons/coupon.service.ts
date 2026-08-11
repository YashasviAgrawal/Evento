import type { PoolClient } from 'pg';
import { dbRunner } from '../../db/pool';
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
  userId: string;
  client?: PoolClient;
}): Promise<CouponEvaluation> {
  const { code, subtotalPaise, eventId, organizerId, userId, client } = options;
  const runner = dbRunner(client);

  const { rows } = await runner.query<CouponRow>(
    `SELECT id, code, type, value, max_discount_paise, min_order_paise, usage_limit_total,
            usage_limit_per_user, used_count, valid_from, valid_until, event_id, organizer_id, is_active
       FROM coupons
      WHERE upper(code) = upper($1)
      ${client ? 'FOR UPDATE' : ''}`,
    [code],
  );

  const coupon = rows[0];
  if (!coupon) throw new NotFoundError('Coupon', 'COUPON_NOT_FOUND');
  if (!coupon.is_active) throw new BadRequestError('This coupon is no longer active', 'COUPON_INACTIVE');

  const now = Date.now();
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

  return { coupon, discountPaise: computeDiscount(coupon, subtotalPaise) };
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
