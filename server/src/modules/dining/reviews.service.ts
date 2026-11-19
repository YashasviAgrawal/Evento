import { withTransaction } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../utils/errors';

/**
 * Reviews are tied to a paid bill — one per visit — which is what lets the
 * product label them "verified diner" honestly.
 */
export async function createReview(
  userId: string,
  input: { billCode: string; rating: number; body?: string | null },
): Promise<{ rating: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; restaurant_id: string }>(
      `SELECT id, restaurant_id FROM dining.bill_payments
        WHERE code = $1 AND user_id = $2 AND status IN ('paid', 'verified')`,
      [input.billCode, userId],
    );
    const bill = rows[0];
    if (!bill) throw new NotFoundError('Bill');

    const inserted = await client.query(
      `INSERT INTO dining.reviews (bill_payment_id, user_id, restaurant_id, rating, body)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (bill_payment_id) DO NOTHING`,
      [bill.id, userId, bill.restaurant_id, input.rating, input.body?.trim() || null],
    );
    if (!inserted.rowCount) throw new ConflictError('You have already reviewed this visit', 'ALREADY_REVIEWED');

    // Aggregates are recomputed from source, never incremented, so they cannot drift.
    await client.query(
      `UPDATE dining.restaurants r SET
         rating_avg = s.avg, rating_count = s.count
         FROM (SELECT round(avg(rating)::numeric, 1) AS avg, count(*)::int AS count
                 FROM dining.reviews WHERE restaurant_id = $1) s
        WHERE r.id = $1`,
      [bill.restaurant_id],
    );
    return { rating: input.rating };
  });
}
