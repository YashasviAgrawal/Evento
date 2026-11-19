/**
 * Privacy under the DPDP Act 2023 and Rules 2025.
 *
 * - Consent per optional purpose, as an append-only log with the notice
 *   version and where it was given. Service-essential processing (your
 *   bookings, payments, receipts) is not consent-based and is not listed.
 * - Data-principal rights: a machine-readable export of everything we hold,
 *   and tracked requests for correction, erasure and nomination.
 * - Erasure anonymises the account and removes free text, but keeps payment,
 *   tax and ledger records that the law requires us to retain.
 */
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../db/pool';
import { NotFoundError } from '../../utils/errors';
import { readableCode } from '../../utils/ids';
import { sendMailAsync } from '../../services/mail.service';

/** Bump when the privacy notice changes; consents record which one they answered. */
export const NOTICE_VERSION = '2026-11';
/** Our service level for answering requests — inside the statutory window. */
export const RESPONSE_DAYS = 30;

export const PURPOSES = {
  marketing_email: { label: 'Offers and news by email', description: 'Festivals, new restaurants and offers picked for you.' },
  marketing_messages: { label: 'Offers by SMS and WhatsApp', description: 'Time-sensitive deals near you. Booking updates are always sent.' },
  personalisation: { label: 'Personalised recommendations', description: 'Use your bookings and visits to suggest places you will like.' },
  analytics: { label: 'Product analytics', description: 'Anonymous usage that helps us fix and improve Tixit.' },
} as const;
export type Purpose = keyof typeof PURPOSES;

export async function getConsents(userId: string) {
  const { rows } = await query<{ purpose: Purpose; granted: boolean; created_at: Date; source: string }>(
    `SELECT DISTINCT ON (purpose) purpose, granted, created_at, source
       FROM privacy.consents WHERE user_id = $1
      ORDER BY purpose, created_at DESC`,
    [userId],
  );
  return (Object.keys(PURPOSES) as Purpose[]).map((purpose) => {
    const row = rows.find((r) => r.purpose === purpose);
    return { purpose, ...PURPOSES[purpose], granted: row?.granted ?? false, updatedAt: row?.created_at ?? null, source: row?.source ?? null };
  });
}

export const consentInput = z.object({
  consents: z.array(z.object({ purpose: z.enum(Object.keys(PURPOSES) as [Purpose, ...Purpose[]]), granted: z.boolean() })).min(1).max(10),
  source: z.string().trim().max(40).default('dinein_web'),
});

/** Record only what changed, so the log reads as a history of decisions. */
export async function setConsents(userId: string, input: z.infer<typeof consentInput>, ip: string | null) {
  const current = await getConsents(userId);
  for (const change of input.consents) {
    const before = current.find((c) => c.purpose === change.purpose);
    if (before && before.granted === change.granted && before.updatedAt) continue;
    await query(
      `INSERT INTO privacy.consents (user_id, purpose, granted, notice_version, source, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, change.purpose, change.granted, NOTICE_VERSION, input.source, ip],
    );
  }
  return getConsents(userId);
}

/** Everything we hold about a person, in one machine-readable document. */
export async function exportData(userId: string) {
  const profile = await queryOne(
    `SELECT id, full_name, email, phone, role, created_at, last_login_at, email_verified_at, phone_verified_at
       FROM users WHERE id = $1`,
    [userId],
  );
  if (!profile) throw new NotFoundError('Account');
  const [bookings, reservations, bills, wallet, reviews, consents, requests, sessions] = await Promise.all([
    query(`SELECT booking_code, status, total_paise, created_at FROM bookings WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    query(
      `SELECT v.code, r.name AS restaurant, v.starts_at, v.party_size, v.status, v.occasion, v.notes, v.cover_paise, v.cover_status
         FROM dining.reservations v JOIN dining.restaurants r ON r.id = v.restaurant_id WHERE v.user_id = $1 ORDER BY v.starts_at DESC`,
      [userId],
    ),
    query(
      `SELECT b.code, r.name AS restaurant, b.status, b.bill_total_paise, b.amount_payable_paise, b.paid_at
         FROM dining.bill_payments b JOIN dining.restaurants r ON r.id = b.restaurant_id WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
      [userId],
    ),
    query(`SELECT amount_paise, remaining_paise, status, available_at, expires_at, created_at FROM finance.wallet_credits WHERE user_id = $1`, [userId]),
    query(`SELECT rating, body, created_at FROM dining.reviews WHERE user_id = $1`, [userId]),
    query(`SELECT purpose, granted, notice_version, source, created_at FROM privacy.consents WHERE user_id = $1 ORDER BY created_at`, [userId]),
    query(`SELECT reference, kind, status, created_at, resolved_at FROM privacy.requests WHERE user_id = $1`, [userId]),
    query(`SELECT created_at, user_agent, revoked_at FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId]),
  ]);
  return {
    exportedAt: new Date(),
    noticeVersion: NOTICE_VERSION,
    profile,
    eventBookings: bookings.rows,
    tableReservations: reservations.rows,
    billPayments: bills.rows,
    walletCredits: wallet.rows,
    reviews: reviews.rows,
    consents: consents.rows,
    privacyRequests: requests.rows,
    signIns: sessions.rows,
  };
}

/* ───────────────────────── data-principal requests ───────────────────────── */

export const requestInput = z.object({
  kind: z.enum(['access', 'correction', 'erasure', 'nominate']),
  details: z.string().trim().max(2000).nullish(),
});

export async function createRequest(user: { id: string; email: string; fullName: string }, input: z.infer<typeof requestInput>) {
  const reference = `DPR-${readableCode(6)}`;
  const row = await queryOne<{ id: string; due_at: Date }>(
    `INSERT INTO privacy.requests (reference, user_id, kind, details, due_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id, due_at`,
    [reference, user.id, input.kind, input.details ?? null, RESPONSE_DAYS],
  );
  sendMailAsync({
    to: user.email,
    template: 'privacy_update',
    userId: user.id,
    data: { name: user.fullName.split(' ')[0] ?? user.fullName, reference, kind: input.kind, status: 'received', message: null, dueAt: row!.due_at },
  });
  return { reference, dueAt: row!.due_at };
}

export async function listMyRequests(userId: string) {
  const { rows } = await query(
    `SELECT reference, kind, status, details, resolution, due_at, resolved_at, created_at FROM privacy.requests
      WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

export async function listRequests() {
  const { rows } = await query(
    `SELECT p.id, p.reference, p.kind, p.status, p.details, p.resolution, p.due_at, p.resolved_at, p.created_at,
            u.full_name, u.email
       FROM privacy.requests p LEFT JOIN users u ON u.id = p.user_id
      ORDER BY (p.status IN ('open', 'in_progress')) DESC, p.due_at`,
  );
  return rows;
}

/**
 * Anonymise an account. Identity, contact details, sign-in methods and free
 * text go; amounts, dates and codes on payments stay, because tax and
 * payment rules require us to keep them.
 */
export async function eraseAccount(userId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET full_name = 'Deleted user', email = 'deleted+' || id || '@tixit.invalid', phone = NULL,
              password_hash = NULL, google_id = NULL, avatar_url = NULL, status = 'deleted'
        WHERE id = $1`,
      [userId],
    );
    await client.query(`UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'admin' WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await client.query(`UPDATE dining.reviews SET body = NULL WHERE user_id = $1`, [userId]);
    await client.query(`UPDATE dining.reservations SET guest_name = 'Guest', guest_phone = NULL, notes = NULL, occasion = NULL WHERE user_id = $1`, [userId]);
    await client.query(`UPDATE bookings SET customer_name = 'Deleted user', customer_email = 'deleted@tixit.invalid', customer_phone = '' WHERE user_id = $1`, [userId]);
  });
}

export const resolveInput = z.object({
  status: z.enum(['in_progress', 'completed', 'rejected']),
  resolution: z.string().trim().max(2000).nullish(),
});

export async function resolveRequest(id: string, input: z.infer<typeof resolveInput>, adminId: string) {
  const request = await queryOne<{ user_id: string | null; kind: string; reference: string; email: string; full_name: string }>(
    `SELECT p.user_id, p.kind, p.reference, u.email, u.full_name FROM privacy.requests p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
    [id],
  );
  if (!request) throw new NotFoundError('Request');
  // Tell the person before their address is anonymised.
  sendMailAsync({
    to: request.email,
    template: 'privacy_update',
    userId: request.user_id,
    data: {
      name: request.full_name.split(' ')[0] ?? request.full_name,
      reference: request.reference,
      kind: request.kind,
      status: input.status,
      message: input.resolution ?? null,
      dueAt: null,
    },
  });
  if (request.kind === 'erasure' && input.status === 'completed' && request.user_id) await eraseAccount(request.user_id);
  await query(
    `UPDATE privacy.requests SET status = $2, resolution = $3, resolved_by = $4,
            resolved_at = CASE WHEN $2 IN ('completed', 'rejected') THEN now() END
      WHERE id = $1`,
    [id, input.status, input.resolution ?? null, adminId],
  );
}

/* ───────────────────────── grievances ───────────────────────── */

export const grievanceInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().max(20).nullish(),
  category: z.enum(['payment', 'booking', 'restaurant', 'privacy', 'account', 'other']),
  subject: z.string().trim().min(4).max(160),
  body: z.string().trim().min(10).max(5000),
  orderRef: z.string().trim().max(20).nullish(),
});

/** Grievances are acknowledged at once and resolved within the response window. */
export async function createGrievance(input: z.infer<typeof grievanceInput>, userId: string | null) {
  const reference = `GRV-${readableCode(6)}`;
  const row = await queryOne<{ due_at: Date }>(
    `INSERT INTO privacy.grievances (reference, user_id, name, email, phone, category, subject, body, order_ref, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(days => $10)) RETURNING due_at`,
    [reference, userId, input.name, input.email, input.phone ?? null, input.category, input.subject, input.body, input.orderRef ?? null, RESPONSE_DAYS],
  );
  sendMailAsync({
    to: input.email,
    template: 'grievance_update',
    userId,
    data: { name: input.name.split(' ')[0] ?? input.name, reference, subject: input.subject, status: 'received', response: null, dueAt: row!.due_at },
  });
  return { reference, dueAt: row!.due_at };
}

export async function listGrievances() {
  const { rows } = await query(
    `SELECT id, reference, name, email, phone, category, subject, body, order_ref, status, response, due_at, responded_at, created_at
       FROM privacy.grievances ORDER BY (status IN ('open', 'in_progress')) DESC, due_at`,
  );
  return rows;
}

export const grievanceResponseInput = z.object({
  status: z.enum(['in_progress', 'resolved', 'closed']),
  response: z.string().trim().min(2).max(5000),
});

export async function respondToGrievance(id: string, input: z.infer<typeof grievanceResponseInput>, adminId: string) {
  const row = await queryOne<{ reference: string; email: string; name: string; subject: string; user_id: string | null }>(
    `UPDATE privacy.grievances SET status = $2, response = $3, responded_by = $4, responded_at = now()
      WHERE id = $1 RETURNING reference, email, name, subject, user_id`,
    [id, input.status, input.response, adminId],
  );
  if (!row) throw new NotFoundError('Grievance');
  sendMailAsync({
    to: row.email,
    template: 'grievance_update',
    userId: row.user_id,
    data: { name: row.name.split(' ')[0] ?? row.name, reference: row.reference, subject: row.subject, status: input.status, response: input.response, dueAt: null },
  });
}
