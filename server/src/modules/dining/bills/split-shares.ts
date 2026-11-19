import crypto from 'node:crypto';
import type { Queryable } from '../../../db/pool';
import { BadRequestError } from '../../../utils/errors';

/**
 * Creating the shares of a split bill. Kept apart from the split lifecycle
 * (split.service) so bill creation can use it without a circular import.
 */

export const MAX_SPLIT = 10;
export const MIN_SHARE_PAISE = 5_000;
export const SPLIT_WINDOW_MINUTES = 120;
export const SPLIT_TOPICS = { refund: 'dining.bill_share.refund' } as const;

/** Equal shares in paise; the first (the host's) takes the remainder. */
export function splitAmounts(totalPaise: number, count: number): number[] {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) throw new Error('Split total must be positive paise');
  if (!Number.isInteger(count) || count < 1) throw new Error('Split count must be a positive integer');
  const base = Math.floor(totalPaise / count);
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + (totalPaise - base * count) : base));
}

function shareToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

/** Called by createBill, inside its transaction, for a bill being split. */
export async function createShares(client: Queryable, billId: string, payablePaise: number, count: number): Promise<void> {
  if (count < 2 || count > MAX_SPLIT) throw new BadRequestError(`Split between 2 and ${MAX_SPLIT} people`, 'SPLIT_COUNT');
  if (Math.floor(payablePaise / count) < MIN_SHARE_PAISE) {
    throw new BadRequestError(`Each share must be at least ₹${MIN_SHARE_PAISE / 100}`, 'SPLIT_TOO_SMALL');
  }
  for (const [index, amount] of splitAmounts(payablePaise, count).entries()) {
    await client.query(
      'INSERT INTO dining.bill_shares (bill_payment_id, share_no, amount_paise, token) VALUES ($1, $2, $3, $4)',
      [billId, index + 1, amount, shareToken()],
    );
  }
  await client.query(
    `UPDATE dining.bill_payments SET split_count = $2, split_expires_at = now() + make_interval(mins => $3) WHERE id = $1`,
    [billId, count, SPLIT_WINDOW_MINUTES],
  );
}

