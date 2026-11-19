import { query, queryOne, withTransaction } from '../../db/pool';
import { deleteImage, storeImage } from '../../services/storage.service';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';

/**
 * Reviews are tied to a paid bill — one per visit — which is what lets the
 * product label them "verified diner" honestly. The same holds for photos:
 * only the diner who paid can add them, so they publish straight away and
 * moderation takes them down after the fact when needed.
 */

export const MAX_PHOTOS_PER_REVIEW = 5;

export async function createReview(
  userId: string,
  input: { billCode: string; rating: number; body?: string | null },
): Promise<{ id: string; rating: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; restaurant_id: string }>(
      `SELECT id, restaurant_id FROM dining.bill_payments
        WHERE code = $1 AND user_id = $2 AND status IN ('paid', 'verified')`,
      [input.billCode, userId],
    );
    const bill = rows[0];
    if (!bill) throw new NotFoundError('Bill');

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO dining.reviews (bill_payment_id, user_id, restaurant_id, rating, body)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (bill_payment_id) DO NOTHING RETURNING id`,
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
    return { id: inserted.rows[0]!.id, rating: input.rating };
  });
}

/* ─────────────── diner photos ─────────────── */

export interface ReviewPhoto {
  id: string;
  url: string;
}

/**
 * Store first, then claim a slot under a row lock on the review — so two
 * parallel uploads cannot both squeeze past the limit. If the claim fails the
 * stored file is removed again.
 */
export async function addReviewPhoto(userId: string, reviewId: string, file: Express.Multer.File | undefined): Promise<ReviewPhoto> {
  const review = await queryOne<{ id: string }>('SELECT id FROM dining.reviews WHERE id = $1 AND user_id = $2', [reviewId, userId]);
  if (!review) throw new NotFoundError('Review');

  const stored = await storeImage(file, 'reviews');
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query<{ restaurant_id: string }>(
        'SELECT restaurant_id FROM dining.reviews WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [reviewId, userId],
      );
      if (!rows[0]) throw new NotFoundError('Review');
      const count = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM dining.review_photos WHERE review_id = $1', [reviewId]);
      if (count.rows[0]!.n >= MAX_PHOTOS_PER_REVIEW) {
        throw new BadRequestError(`Up to ${MAX_PHOTOS_PER_REVIEW} photos per visit`, 'PHOTO_LIMIT');
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO dining.review_photos (review_id, restaurant_id, user_id, url, public_id, provider)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [reviewId, rows[0].restaurant_id, userId, stored.url, stored.publicId, stored.provider],
      );
      return { id: inserted.rows[0]!.id, url: stored.url };
    });
  } catch (error) {
    await deleteImage(stored);
    throw error;
  }
}

export async function deleteReviewPhoto(userId: string, reviewId: string, photoId: string): Promise<void> {
  const row = await queryOne<{ public_id: string; provider: 'cloudinary' | 'local' }>(
    `DELETE FROM dining.review_photos WHERE id = $1 AND review_id = $2 AND user_id = $3
     RETURNING public_id, provider`,
    [photoId, reviewId, userId],
  );
  if (!row) throw new NotFoundError('Photo');
  await deleteImage({ publicId: row.public_id, provider: row.provider });
}

/** Erasure (DPDP): a deleted account's photos go, files included. */
export async function deleteAllPhotosOf(userId: string): Promise<void> {
  const { rows } = await query<{ public_id: string; provider: 'cloudinary' | 'local' }>(
    'DELETE FROM dining.review_photos WHERE user_id = $1 RETURNING public_id, provider',
    [userId],
  );
  for (const row of rows) await deleteImage({ publicId: row.public_id, provider: row.provider });
}

/** Visible photos for a set of reviews, grouped by review. */
export async function photosForReviews(reviewIds: string[]): Promise<Map<string, ReviewPhoto[]>> {
  const map = new Map<string, ReviewPhoto[]>();
  if (reviewIds.length === 0) return map;
  const { rows } = await query<{ id: string; review_id: string; url: string }>(
    `SELECT id, review_id, url FROM dining.review_photos
      WHERE review_id = ANY($1::uuid[]) AND status = 'visible' ORDER BY created_at`,
    [reviewIds],
  );
  for (const row of rows) {
    const list = map.get(row.review_id) ?? [];
    list.push({ id: row.id, url: row.url });
    map.set(row.review_id, list);
  }
  return map;
}

/* ─────────────── restaurant side ─────────────── */

export async function listRestaurantReviews(restaurantId: string, filter: 'all' | 'unreplied') {
  const { rows } = await query<{
    id: string;
    rating: number;
    body: string | null;
    reply: string | null;
    replied_at: Date | null;
    created_at: Date;
    full_name: string;
    bill_code: string;
  }>(
    `SELECT rv.id, rv.rating, rv.body, rv.reply, rv.replied_at, rv.created_at, u.full_name, b.code AS bill_code
       FROM dining.reviews rv
       JOIN users u ON u.id = rv.user_id
       JOIN dining.bill_payments b ON b.id = rv.bill_payment_id
      WHERE rv.restaurant_id = $1 AND ($2 = 'all' OR (rv.reply IS NULL AND rv.body IS NOT NULL))
      ORDER BY rv.created_at DESC LIMIT 100`,
    [restaurantId, filter],
  );
  const photos = await photosForReviews(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    body: row.body,
    reply: row.reply,
    repliedAt: row.replied_at,
    createdAt: row.created_at,
    author: shortName(row.full_name),
    billCode: row.bill_code,
    photos: photos.get(row.id) ?? [],
  }));
}

/** One public reply per review; editing replaces it. */
export async function replyToReview(restaurantId: string, reviewId: string, reply: string | null) {
  const row = await queryOne(
    `UPDATE dining.reviews SET reply = $3, replied_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END
      WHERE id = $1 AND restaurant_id = $2 RETURNING id`,
    [reviewId, restaurantId, reply?.trim() || null],
  );
  if (!row) throw new NotFoundError('Review');
}

/* ─────────────── moderation ─────────────── */

export async function listPhotosForModeration(status: 'visible' | 'hidden', limit = 60) {
  const { rows } = await query<{
    id: string;
    url: string;
    status: string;
    hidden_reason: string | null;
    created_at: Date;
    restaurant_name: string;
    restaurant_slug: string;
    full_name: string;
  }>(
    `SELECT p.id, p.url, p.status, p.hidden_reason, p.created_at, r.name AS restaurant_name, r.slug AS restaurant_slug, u.full_name
       FROM dining.review_photos p
       JOIN dining.restaurants r ON r.id = p.restaurant_id
       JOIN users u ON u.id = p.user_id
      WHERE p.status = $1
      ORDER BY p.created_at DESC LIMIT $2`,
    [status, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    status: row.status,
    hiddenReason: row.hidden_reason,
    createdAt: row.created_at,
    restaurant: { name: row.restaurant_name, slug: row.restaurant_slug },
    author: shortName(row.full_name),
  }));
}

export async function moderatePhoto(adminId: string, photoId: string, input: { status: 'visible' | 'hidden'; reason?: string | null }) {
  if (input.status === 'hidden' && !input.reason?.trim()) {
    throw new BadRequestError('Say why the photo is hidden', 'REASON_REQUIRED');
  }
  const row = await queryOne(
    `UPDATE dining.review_photos SET status = $2, hidden_reason = $3, moderated_by = $4, moderated_at = now()
      WHERE id = $1 RETURNING id`,
    [photoId, input.status, input.status === 'hidden' ? input.reason!.trim() : null, adminId],
  );
  if (!row) throw new NotFoundError('Photo');
}

/** First name and initial only — enough to feel human, not enough to identify. */
export function shortName(fullName: string): string {
  return fullName
    .split(' ')
    .map((part, i) => (i === 0 ? part : `${part[0]}.`))
    .join(' ');
}
