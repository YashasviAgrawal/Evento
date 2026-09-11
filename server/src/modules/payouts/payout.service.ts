import { z } from 'zod';
import { query, queryOne } from '../../db/pool';
import { generatePayoutReference } from '../../utils/ids';
import { rupeesToPaise } from '../../utils/money';
import { ConflictError, NotFoundError } from '../../utils/errors';
import { getKycState, KYC_STATUS_SQL, maskAccountNumber, type KycStatus } from './kyc.service';

/**
 * Organizer payouts.
 *
 * The platform collects every rupee a customer pays and owes the organizer
 * their share, so an organizer's account is a running balance:
 *
 *   earned   = Σ organizer_payout_paise − Σ refunded_paise   (confirmed bookings)
 *   settled  = Σ payouts that are paid, processing or pending
 *   pending  = earned − settled
 *
 * Payouts are recorded by hand against that balance rather than being tied to
 * individual bookings: one bank transfer covers a period's worth of orders, and
 * finance reconciles on the period, not the order.
 *
 * `pending` is deliberately allowed to go negative. An advance, or a refund
 * issued after a settlement, genuinely leaves the organizer owing the platform,
 * and hiding that behind a zero floor would quietly lose money.
 */

/** Matches the reports module: only money actually collected counts. */
const EARNED_STATUSES = `('confirmed', 'refunded', 'partially_refunded')`;

/** Anything not in a terminal failure state is money already committed. */
const SETTLING_STATUSES = `('pending', 'processing', 'paid')`;

export const PAYOUT_METHODS = ['bank_transfer', 'upi', 'cheque', 'cash', 'other'] as const;
export const PAYOUT_STATUSES = ['pending', 'processing', 'paid', 'failed', 'cancelled'] as const;

/** Rupees in, paise out — the admin form talks in rupees, the ledger in paise. */
const rupeeAmount = z.coerce.number().min(0).max(100_000_000);

const PAYOUT_FIELDS = z.object({
  amount: rupeeAmount.refine((value) => value > 0, 'Enter the amount paid'),
  tds: rupeeAmount.default(0),
  fee: rupeeAmount.default(0),
  method: z.enum(PAYOUT_METHODS).default('bank_transfer'),
  status: z.enum(PAYOUT_STATUSES).default('paid'),
  utr: z.string().trim().max(60).nullable().optional(),
  periodStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
  periodEnd: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
  paidAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const PAYOUT_INPUT = PAYOUT_FIELDS
  .refine((value) => value.tds + value.fee <= value.amount, {
    message: 'TDS and charges cannot exceed the payout amount',
    path: ['tds'],
  })
  .refine((value) => !value.periodStart || !value.periodEnd || value.periodStart <= value.periodEnd, {
    message: 'The period end cannot be before the period start',
    path: ['periodEnd'],
  });

export type PayoutInput = z.infer<typeof PAYOUT_INPUT>;

/** Every field is optional on an edit; only what is sent is written. */
export const PAYOUT_PATCH = PAYOUT_FIELDS.partial();
export type PayoutPatch = z.infer<typeof PAYOUT_PATCH>;

export interface PayoutRecord {
  id: string;
  reference: string;
  organizerId: string;
  amountPaise: number;
  tdsPaise: number;
  feePaise: number;
  netPaise: number;
  method: string;
  status: string;
  utr: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  destination: string | null;
  notes: string | null;
  paidAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; fullName: string } | null;
}

export interface PayoutSummary {
  /** Ticket money collected from customers, before any split. */
  grossRevenuePaise: number;
  /** The platform's commission on those bookings. */
  commissionPaise: number;
  /** GST charged to customers and remitted by the platform. */
  taxPaise: number;
  /** Convenience fee, which the platform keeps. */
  convenienceFeePaise: number;
  refundedPaise: number;
  /** Lifetime earnings owed to the organizer, net of commission and refunds. */
  earnedPaise: number;
  /** Paid out and cleared. */
  paidPaise: number;
  /** Recorded but not yet cleared (pending / processing transfers). */
  inTransitPaise: number;
  /** earned − paid − inTransit. Negative means the organizer was overpaid. */
  pendingPaise: number;
  /** TDS withheld across cleared payouts. */
  tdsPaise: number;
  /** Bank and transfer charges across cleared payouts. */
  feePaise: number;
  payoutCount: number;
  lastPayoutAt: Date | null;
  ticketsSold: number;
  totalBookings: number;
}

function mapPayout(row: Record<string, unknown>): PayoutRecord {
  const amount = Number(row.amount_paise);
  const tds = Number(row.tds_paise);
  const fee = Number(row.fee_paise);
  return {
    id: row.id as string,
    reference: row.reference as string,
    organizerId: row.organizer_id as string,
    amountPaise: amount,
    tdsPaise: tds,
    feePaise: fee,
    netPaise: amount - tds - fee,
    method: row.method as string,
    status: row.status as string,
    utr: (row.utr as string | null) ?? null,
    // DATE comes back as a Date at midnight UTC; the calendar day is all that
    // matters here, so send it as a plain YYYY-MM-DD string.
    periodStart: toDateString(row.period_start),
    periodEnd: toDateString(row.period_end),
    destination: (row.destination as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    paidAt: (row.paid_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    createdBy: row.creator_id
      ? { id: row.creator_id as string, fullName: (row.creator_name as string | null) ?? '' }
      : null,
  };
}

/**
 * `pg` hands back a DATE as a Date at *local* midnight, so formatting it via
 * toISOString() rolls it back a day anywhere east of UTC — the period a payout
 * covers would read 31 July for a payout entered as 1 August. Read the local
 * calendar parts instead, which is the day the column actually holds.
 */
function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

const SELECT_PAYOUT = `
  SELECT p.*, c.id AS creator_id, c.full_name AS creator_name
    FROM organizer_payouts p
    LEFT JOIN users c ON c.id = p.created_by`;

/**
 * The complete money picture for one organizer, in a single round trip per
 * side of the ledger: what the bookings earned them, and what has been sent.
 */
export async function getPayoutSummary(organizerId: string): Promise<PayoutSummary> {
  const [bookings, payouts] = await Promise.all([
    queryOne<Record<string, string>>(
      `SELECT COALESCE(sum(total_paise), 0)::bigint            AS gross,
              COALESCE(sum(commission_paise), 0)::bigint       AS commission,
              COALESCE(sum(tax_paise), 0)::bigint              AS tax,
              COALESCE(sum(convenience_fee_paise), 0)::bigint  AS convenience,
              COALESCE(sum(organizer_payout_paise), 0)::bigint AS payout,
              COALESCE(sum(refunded_paise), 0)::bigint         AS refunded,
              COALESCE(sum(quantity), 0)::int                  AS tickets,
              count(*)::int                                    AS bookings
         FROM bookings
        WHERE organizer_id = $1 AND status IN ${EARNED_STATUSES}`,
      [organizerId],
    ),
    queryOne<Record<string, string>>(
      `SELECT COALESCE(sum(amount_paise) FILTER (WHERE status = 'paid'), 0)::bigint AS paid,
              COALESCE(sum(amount_paise) FILTER (WHERE status IN ('pending', 'processing')), 0)::bigint AS in_transit,
              COALESCE(sum(tds_paise) FILTER (WHERE status = 'paid'), 0)::bigint AS tds,
              COALESCE(sum(fee_paise) FILTER (WHERE status = 'paid'), 0)::bigint AS fee,
              count(*) FILTER (WHERE status IN ${SETTLING_STATUSES})::int AS payouts,
              max(paid_at) FILTER (WHERE status = 'paid') AS last_paid_at
         FROM organizer_payouts
        WHERE organizer_id = $1`,
      [organizerId],
    ),
  ]);

  const earnedPaise = Number(bookings?.payout ?? 0) - Number(bookings?.refunded ?? 0);
  const paidPaise = Number(payouts?.paid ?? 0);
  const inTransitPaise = Number(payouts?.in_transit ?? 0);

  return {
    grossRevenuePaise: Number(bookings?.gross ?? 0),
    commissionPaise: Number(bookings?.commission ?? 0),
    taxPaise: Number(bookings?.tax ?? 0),
    convenienceFeePaise: Number(bookings?.convenience ?? 0),
    refundedPaise: Number(bookings?.refunded ?? 0),
    earnedPaise,
    paidPaise,
    inTransitPaise,
    pendingPaise: earnedPaise - paidPaise - inTransitPaise,
    tdsPaise: Number(payouts?.tds ?? 0),
    feePaise: Number(payouts?.fee ?? 0),
    payoutCount: Number(payouts?.payouts ?? 0),
    lastPayoutAt: (payouts?.last_paid_at as unknown as Date | null) ?? null,
    ticketsSold: Number(bookings?.tickets ?? 0),
    totalBookings: Number(bookings?.bookings ?? 0),
  };
}

export async function listPayouts(
  organizerId: string,
  options: { status?: string; page?: number; limit?: number } = {},
): Promise<{ payouts: PayoutRecord[]; total: number }> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;

  const values: unknown[] = [organizerId];
  let where = 'WHERE p.organizer_id = $1';
  if (options.status) {
    values.push(options.status);
    where += ` AND p.status = $${values.length}::payout_status`;
  }

  const listValues = [...values, limit, (page - 1) * limit];
  const [list, count] = await Promise.all([
    query(
      `${SELECT_PAYOUT}
       ${where}
       ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.created_at DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    ),
    queryOne<{ total: number }>(
      `SELECT count(*)::int AS total FROM organizer_payouts p ${where}`,
      values,
    ),
  ]);

  return { payouts: list.rows.map(mapPayout), total: Number(count?.total ?? 0) };
}

/**
 * Record a transfer the finance team has made (or is about to make).
 *
 * The organizer must be verified, which — since verification *is* KYC approval
 * — means their bank details have been checked by a human and there is an
 * account to send money to. The destination is snapshotted from the KYC record
 * so a later account change cannot rewrite where past payments went.
 */
export async function createPayout(
  organizerId: string,
  input: PayoutInput,
  adminId: string,
): Promise<PayoutRecord> {
  const state = await getKycState(organizerId);
  if (!state.payoutsEnabled || !state.kyc) {
    throw new ConflictError(
      state.kyc
        ? 'This organizer is not verified yet, so a payout cannot be recorded against them.'
        : 'This organizer has not submitted their KYC, so there are no bank details to pay into.',
      'ORGANIZER_NOT_VERIFIED',
    );
  }
  const kyc = state.kyc;

  const destination =
    input.method === 'bank_transfer' || input.method === 'upi'
      ? `${kyc.bankName ? `${kyc.bankName} ` : ''}${maskAccountNumber(kyc.accountNumber)} · ${kyc.ifsc} · ${kyc.accountHolderName}`
      : null;

  const { rows } = await query(
    `INSERT INTO organizer_payouts (reference, organizer_id, amount_paise, tds_paise, fee_paise, method, status,
                                    utr, period_start, period_end, destination, notes, paid_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::payout_method, $7::payout_status, $8, $9, $10, $11, $12,
             CASE WHEN $7::payout_status = 'paid' THEN COALESCE($13::timestamptz, now()) ELSE $13::timestamptz END, $14)
     RETURNING id`,
    [
      generatePayoutReference(),
      organizerId,
      rupeesToPaise(input.amount),
      rupeesToPaise(input.tds),
      rupeesToPaise(input.fee),
      input.method,
      input.status,
      input.utr ?? null,
      input.periodStart ?? null,
      input.periodEnd ?? null,
      destination,
      input.notes ?? null,
      input.paidAt ?? null,
      adminId,
    ],
  );

  const row = await queryOne(`${SELECT_PAYOUT} WHERE p.id = $1`, [rows[0]!.id]);
  return mapPayout(row!);
}

/** Correct a recorded payout — a wrong UTR, a transfer that later failed. */
export async function updatePayout(payoutId: string, patch: PayoutPatch): Promise<PayoutRecord> {
  const existing = await queryOne<Record<string, unknown>>(
    'SELECT amount_paise, tds_paise, fee_paise, period_start, period_end FROM organizer_payouts WHERE id = $1',
    [payoutId],
  );
  if (!existing) throw new NotFoundError('Payout');

  const amountPaise = patch.amount === undefined ? Number(existing.amount_paise) : rupeesToPaise(patch.amount);
  const tdsPaise = patch.tds === undefined ? Number(existing.tds_paise) : rupeesToPaise(patch.tds);
  const feePaise = patch.fee === undefined ? Number(existing.fee_paise) : rupeesToPaise(patch.fee);
  if (tdsPaise + feePaise > amountPaise) {
    throw new ConflictError('TDS and charges cannot exceed the payout amount', 'INVALID_DEDUCTIONS');
  }

  // Editing one end of the period has to be checked against the end already
  // stored, or the database constraint answers with a 500 instead of this.
  const start = patch.periodStart === undefined ? toDateString(existing.period_start) : patch.periodStart;
  const end = patch.periodEnd === undefined ? toDateString(existing.period_end) : patch.periodEnd;
  if (start && end && start > end) {
    throw new ConflictError('The period end cannot be before the period start', 'INVALID_PERIOD');
  }

  const { rows } = await query(
    `UPDATE organizer_payouts SET
       amount_paise = $2,
       tds_paise    = $3,
       fee_paise    = $4,
       method       = COALESCE($5::payout_method, method),
       status       = COALESCE($6::payout_status, status),
       utr          = CASE WHEN $7::boolean THEN $8 ELSE utr END,
       period_start = CASE WHEN $9::boolean THEN $10::date ELSE period_start END,
       period_end   = CASE WHEN $11::boolean THEN $12::date ELSE period_end END,
       notes        = CASE WHEN $13::boolean THEN $14 ELSE notes END,
       -- Marking a transfer paid without naming a date stamps it now; any
       -- other status keeps whatever the caller sent, including NULL.
       paid_at      = CASE
                        WHEN $15::boolean THEN $16::timestamptz
                        WHEN $6::payout_status = 'paid' AND paid_at IS NULL THEN now()
                        ELSE paid_at
                      END
     WHERE id = $1
     RETURNING id`,
    [
      payoutId,
      amountPaise,
      tdsPaise,
      feePaise,
      patch.method ?? null,
      patch.status ?? null,
      patch.utr !== undefined,
      patch.utr ?? null,
      patch.periodStart !== undefined,
      patch.periodStart ?? null,
      patch.periodEnd !== undefined,
      patch.periodEnd ?? null,
      patch.notes !== undefined,
      patch.notes ?? null,
      patch.paidAt !== undefined,
      patch.paidAt ?? null,
    ],
  );
  if (rows.length === 0) throw new NotFoundError('Payout');

  const row = await queryOne(`${SELECT_PAYOUT} WHERE p.id = $1`, [rows[0]!.id]);
  return mapPayout(row!);
}

/** Delete an entry that should never have existed — a typo, a duplicate. */
export async function deletePayout(payoutId: string): Promise<{ organizerId: string; reference: string }> {
  const { rows } = await query<{ organizer_id: string; reference: string }>(
    'DELETE FROM organizer_payouts WHERE id = $1 RETURNING organizer_id, reference',
    [payoutId],
  );
  if (rows.length === 0) throw new NotFoundError('Payout');
  return { organizerId: rows[0]!.organizer_id, reference: rows[0]!.reference };
}

export interface OrganizerLedgerRow {
  id: string;
  displayName: string;
  slug: string;
  status: string;
  logoUrl: string | null;
  contact: { fullName: string; email: string };
  kycStatus: KycStatus;
  grossRevenuePaise: number;
  commissionPaise: number;
  earnedPaise: number;
  paidPaise: number;
  inTransitPaise: number;
  pendingPaise: number;
  lastPayoutAt: Date | null;
}

export interface LedgerTotals {
  organizers: number;
  kycPending: number;
  kycApproved: number;
  kycMissing: number;
  grossRevenuePaise: number;
  commissionPaise: number;
  earnedPaise: number;
  paidPaise: number;
  inTransitPaise: number;
  pendingPaise: number;
}

const LEDGER_SORTS: Record<string, string> = {
  pending: 'pending DESC',
  revenue: 'gross DESC',
  paid: 'paid DESC',
  name: 'display_name ASC',
};

/**
 * The payouts index: every organizer with what they are owed, so finance can
 * work top-down through the list instead of opening accounts one at a time.
 */
export async function getOrganizerLedger(filters: {
  q?: string;
  kycStatus?: string;
  owing?: boolean;
  sort?: string;
  page?: number;
  limit?: number;
}): Promise<{ organizers: OrganizerLedgerRow[]; totals: LedgerTotals; total: number }> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.q) {
    values.push(filters.q);
    conditions.push(
      `(o.display_name ILIKE '%' || $${values.length} || '%' OR u.email ILIKE '%' || $${values.length} || '%')`,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Both of these read computed columns — the balance needs the lateral joins,
  // and kyc_status is a CASE over the organizer's own status — so they are
  // predicates on the outer select rather than on the joins.
  const outer: string[] = [];
  if (filters.owing) outer.push('pending > 0');
  if (filters.kycStatus) {
    values.push(filters.kycStatus);
    outer.push(`kyc_status = $${values.length}`);
  }
  const having = outer.length ? `WHERE ${outer.join(' AND ')}` : '';
  const orderBy = LEDGER_SORTS[filters.sort ?? 'pending'] ?? LEDGER_SORTS.pending;

  const base = `
    SELECT o.id, o.display_name, o.slug, o.status, o.logo_url,
           u.full_name, u.email,
           ${KYC_STATUS_SQL} AS kyc_status,
           bk.gross, bk.commission,
           (bk.payout - bk.refunded) AS earned,
           py.paid, py.in_transit, py.last_paid_at,
           (bk.payout - bk.refunded - py.paid - py.in_transit) AS pending
      FROM organizers o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN organizer_kyc k ON k.organizer_id = o.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(b.total_paise), 0)::bigint            AS gross,
               COALESCE(sum(b.commission_paise), 0)::bigint       AS commission,
               COALESCE(sum(b.organizer_payout_paise), 0)::bigint AS payout,
               COALESCE(sum(b.refunded_paise), 0)::bigint         AS refunded
          FROM bookings b
         WHERE b.organizer_id = o.id AND b.status IN ${EARNED_STATUSES}
      ) bk ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(p.amount_paise) FILTER (WHERE p.status = 'paid'), 0)::bigint AS paid,
               COALESCE(sum(p.amount_paise) FILTER (WHERE p.status IN ('pending', 'processing')), 0)::bigint AS in_transit,
               max(p.paid_at) FILTER (WHERE p.status = 'paid') AS last_paid_at
          FROM organizer_payouts p WHERE p.organizer_id = o.id
      ) py ON TRUE
      ${where}`;

  const listValues = [...values, limit, (page - 1) * limit];
  const [list, totals] = await Promise.all([
    query(
      `SELECT * FROM (${base}) ledger
       ${having}
       ORDER BY ${orderBy}, display_name ASC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    ),
    queryOne<Record<string, string>>(
      `SELECT count(*)::int AS organizers,
              count(*) FILTER (WHERE kyc_status = 'pending')::int  AS kyc_pending,
              count(*) FILTER (WHERE kyc_status = 'approved')::int AS kyc_approved,
              count(*) FILTER (WHERE kyc_status = 'not_submitted')::int AS kyc_missing,
              COALESCE(sum(gross), 0)::bigint      AS gross,
              COALESCE(sum(commission), 0)::bigint AS commission,
              COALESCE(sum(earned), 0)::bigint     AS earned,
              COALESCE(sum(paid), 0)::bigint       AS paid,
              COALESCE(sum(in_transit), 0)::bigint AS in_transit,
              COALESCE(sum(pending), 0)::bigint    AS pending
         FROM (${base}) ledger
         ${having}`,
      values,
    ),
  ]);

  return {
    organizers: list.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      slug: row.slug,
      status: row.status,
      logoUrl: row.logo_url,
      contact: { fullName: row.full_name, email: row.email },
      kycStatus: row.kyc_status,
      grossRevenuePaise: Number(row.gross ?? 0),
      commissionPaise: Number(row.commission ?? 0),
      earnedPaise: Number(row.earned ?? 0),
      paidPaise: Number(row.paid ?? 0),
      inTransitPaise: Number(row.in_transit ?? 0),
      pendingPaise: Number(row.pending ?? 0),
      lastPayoutAt: row.last_paid_at,
    })),
    totals: {
      organizers: Number(totals?.organizers ?? 0),
      kycPending: Number(totals?.kyc_pending ?? 0),
      kycApproved: Number(totals?.kyc_approved ?? 0),
      kycMissing: Number(totals?.kyc_missing ?? 0),
      grossRevenuePaise: Number(totals?.gross ?? 0),
      commissionPaise: Number(totals?.commission ?? 0),
      earnedPaise: Number(totals?.earned ?? 0),
      paidPaise: Number(totals?.paid ?? 0),
      inTransitPaise: Number(totals?.in_transit ?? 0),
      pendingPaise: Number(totals?.pending ?? 0),
    },
    total: Number(totals?.organizers ?? 0),
  };
}

/** Per-event earnings, so a payout can be reconciled against what it covers. */
export async function getEventEarnings(organizerId: string) {
  const { rows } = await query(
    `SELECT e.id, e.title, e.slug, e.status, e.starts_at,
            count(b.id)::int                                  AS bookings,
            COALESCE(sum(b.quantity), 0)::int                 AS tickets,
            COALESCE(sum(b.total_paise), 0)::bigint           AS gross,
            COALESCE(sum(b.commission_paise), 0)::bigint      AS commission,
            COALESCE(sum(b.tax_paise), 0)::bigint             AS tax,
            COALESCE(sum(b.organizer_payout_paise), 0)::bigint AS payout,
            COALESCE(sum(b.refunded_paise), 0)::bigint        AS refunded
       FROM events e
       LEFT JOIN bookings b ON b.event_id = e.id AND b.status IN ${EARNED_STATUSES}
      WHERE e.organizer_id = $1
      GROUP BY e.id
     HAVING count(b.id) > 0
      ORDER BY sum(b.total_paise) DESC NULLS LAST
      LIMIT 100`,
    [organizerId],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    startsAt: row.starts_at,
    bookings: Number(row.bookings),
    tickets: Number(row.tickets),
    grossRevenuePaise: Number(row.gross),
    commissionPaise: Number(row.commission),
    taxPaise: Number(row.tax),
    refundedPaise: Number(row.refunded),
    earnedPaise: Number(row.payout) - Number(row.refunded),
  }));
}
