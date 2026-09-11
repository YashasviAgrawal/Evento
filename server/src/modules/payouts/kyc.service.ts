import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../utils/errors';

/**
 * Organizer KYC — and, because the two are the same decision, organizer
 * verification.
 *
 * An organizer signs up, submits the identity, business and bank details the
 * finance team needs, and an admin's single approve/reject on that submission
 * sets `organizers.status`. There is deliberately no separate KYC status: the
 * state shown in the UI is derived from whether a submission exists plus the
 * organizer's own status, so the two can never disagree.
 */

export const KYC_FIELDS = z.object({
  legalName: z
    .string()
    .trim()
    .min(2, 'Enter your full name as printed on your PAN card')
    .max(120),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN looks like AAAAA0000A'),
  businessName: z.string().trim().min(2, 'Enter your registered business or brand name').max(160),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}[0-9A-Z]$/, 'GSTIN is 15 characters, e.g. 22AAAAA0000A1Z5')
    .nullable()
    .optional(),
  businessAddress: z.string().trim().min(10, 'Enter the full registered address').max(500),
  accountHolderName: z.string().trim().min(2, 'Enter the name on the bank account').max(120),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{9,18}$/, 'Account number is 9–18 digits'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks like HDFC0001234'),
  bankName: z.string().trim().max(120).nullable().optional(),
});

export type KycInput = z.infer<typeof KYC_FIELDS>;

/** What was submitted. The review outcome lives on the organizer, not here. */
export interface KycRecord {
  id: string;
  organizerId: string;
  legalName: string;
  pan: string;
  businessName: string;
  gstin: string | null;
  businessAddress: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string | null;
  submittedAt: Date;
}

/** Derived from the submission plus the organizer's verification status. */
export type KycStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected';

export interface KycState {
  status: KycStatus;
  /** Verified *and* on file — a payout needs an account to send money to. */
  payoutsEnabled: boolean;
  organizerStatus: string;
  verifiedAt: Date | null;
  rejectionReason: string | null;
  reviewedBy: { id: string; fullName: string } | null;
  kyc: KycRecord | null;
}

/** Last four digits only — enough to recognise an account, not to use it. */
export function maskAccountNumber(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

/**
 * The one place the merged status is worked out. A suspended organizer's
 * submission still reads as "under review" — suspension is a separate lever,
 * not a KYC verdict.
 */
export function deriveKycStatus(hasSubmission: boolean, organizerStatus: string): KycStatus {
  if (!hasSubmission) return 'not_submitted';
  if (organizerStatus === 'verified') return 'approved';
  if (organizerStatus === 'rejected') return 'rejected';
  return 'pending';
}

/** Shared by every branch of the CASE above, for use inside SQL. */
export const KYC_STATUS_SQL = `
  CASE
    WHEN k.id IS NULL          THEN 'not_submitted'
    WHEN o.status = 'verified' THEN 'approved'
    WHEN o.status = 'rejected' THEN 'rejected'
    ELSE 'pending'
  END`;

function mapKyc(row: Record<string, unknown>): KycRecord {
  return {
    id: row.id as string,
    organizerId: row.organizer_id as string,
    legalName: row.legal_name as string,
    pan: row.pan as string,
    businessName: row.business_name as string,
    gstin: (row.gstin as string | null) ?? null,
    businessAddress: row.business_address as string,
    accountHolderName: row.account_holder_name as string,
    accountNumber: row.account_number as string,
    ifsc: row.ifsc as string,
    bankName: (row.bank_name as string | null) ?? null,
    submittedAt: row.submitted_at as Date,
  };
}

export async function getKyc(organizerId: string): Promise<KycRecord | null> {
  const row = await queryOne('SELECT * FROM organizer_kyc WHERE organizer_id = $1', [organizerId]);
  return row ? mapKyc(row) : null;
}

/** The submission and the verification decision, in one round trip. */
export async function getKycState(organizerId: string): Promise<KycState> {
  const row = await queryOne(
    `SELECT o.status AS organizer_status, o.verified_at, o.rejection_reason,
            v.id AS reviewer_id, v.full_name AS reviewer_name,
            k.*
       FROM organizers o
       LEFT JOIN organizer_kyc k ON k.organizer_id = o.id
       LEFT JOIN users v         ON v.id = o.verified_by
      WHERE o.id = $1`,
    [organizerId],
  );
  if (!row) throw new NotFoundError('Organizer');

  // k.* is all NULLs when the LEFT JOIN misses, so the submission's own id is
  // what says whether there is one.
  const kyc = row.id ? mapKyc(row) : null;
  const organizerStatus = row.organizer_status as string;

  return {
    status: deriveKycStatus(kyc !== null, organizerStatus),
    payoutsEnabled: kyc !== null && organizerStatus === 'verified',
    organizerStatus,
    verifiedAt: (row.verified_at as Date | null) ?? null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    reviewedBy: row.reviewer_id
      ? { id: row.reviewer_id as string, fullName: (row.reviewer_name as string | null) ?? '' }
      : null,
    kyc,
  };
}

/**
 * Submit — or resubmit after a rejection — the organizer's KYC.
 *
 * A verified organizer's details are frozen: changing the bank account behind
 * an approval is a review decision, not a self-service edit, so an admin has to
 * reopen the account first. Everything else is an upsert that puts the
 * organizer back into the review queue.
 */
export async function submitKyc(organizerId: string, input: KycInput): Promise<KycState> {
  await withTransaction(async (client) => {
    const organizer = await client.query<{ status: string }>(
      'SELECT status FROM organizers WHERE id = $1 FOR UPDATE',
      [organizerId],
    );
    if (organizer.rows.length === 0) throw new NotFoundError('Organizer');
    if (organizer.rows[0]!.status === 'verified') {
      throw new ConflictError(
        'Your account is already verified. Contact support to change these details.',
        'KYC_LOCKED',
      );
    }

    await client.query(
      `INSERT INTO organizer_kyc (organizer_id, legal_name, pan, business_name, gstin, business_address,
                                  account_holder_name, account_number, ifsc, bank_name, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (organizer_id) DO UPDATE SET
         legal_name          = EXCLUDED.legal_name,
         pan                 = EXCLUDED.pan,
         business_name       = EXCLUDED.business_name,
         gstin               = EXCLUDED.gstin,
         business_address    = EXCLUDED.business_address,
         account_holder_name = EXCLUDED.account_holder_name,
         account_number      = EXCLUDED.account_number,
         ifsc                = EXCLUDED.ifsc,
         bank_name           = EXCLUDED.bank_name,
         submitted_at        = now()`,
      [
        organizerId,
        input.legalName,
        input.pan,
        input.businessName,
        input.gstin ?? null,
        input.businessAddress,
        input.accountHolderName,
        input.accountNumber,
        input.ifsc,
        input.bankName ?? null,
      ],
    );

    // Resubmitting after a rejection returns the organizer to the queue and
    // clears the stale reason, so the admin sees a fresh application. Any other
    // status is left alone — suspension is a separate lever, not a KYC verdict.
    // The identity facts are also mirrored onto the profile, which the settings
    // and report screens read, so the two never disagree.
    await client.query(
      `UPDATE organizers
          SET pan     = $2,
              gstin   = COALESCE($3, gstin),
              address = $4,
              status  = CASE WHEN status = 'rejected' THEN 'pending'::organizer_status ELSE status END,
              rejection_reason = CASE WHEN status = 'rejected' THEN NULL ELSE rejection_reason END
        WHERE id = $1`,
      [organizerId, input.pan, input.gstin ?? null, input.businessAddress],
    );
  });

  return getKycState(organizerId);
}

export interface OrganizerReviewResult extends KycState {
  organizerId: string;
  organizerName: string;
  contactName: string;
  contactEmail: string;
}

export type ReviewDecision = 'verified' | 'rejected' | 'pending' | 'suspended';

/**
 * The single organizer review decision.
 *
 * `verified` requires a submission to have been reviewed — that is the whole
 * point of merging the two gates, and it also guarantees there is a bank
 * account to pay into. `pending` reopens a verified account so the organizer
 * can correct details they are otherwise locked out of.
 */
export async function reviewOrganizer(
  organizerId: string,
  decision: ReviewDecision,
  adminId: string,
  reason?: string | null,
): Promise<OrganizerReviewResult> {
  const current = await queryOne<{ status: string; has_kyc: boolean; was_verified: boolean }>(
    `SELECT o.status, (k.id IS NOT NULL) AS has_kyc, (o.verified_at IS NOT NULL) AS was_verified
       FROM organizers o LEFT JOIN organizer_kyc k ON k.organizer_id = o.id
      WHERE o.id = $1`,
    [organizerId],
  );
  if (!current) throw new NotFoundError('Organizer');

  // A first verification needs a submission to verify *on*. Accounts verified
  // before KYC existed are grandfathered, so suspending and reinstating one
  // still works — but they cannot be paid until they do submit, which
  // createPayout enforces separately.
  if (decision === 'verified' && !current.has_kyc && !current.was_verified) {
    throw new ConflictError(
      'This organizer has not submitted their KYC yet, so there is nothing to verify.',
      'KYC_NOT_SUBMITTED',
    );
  }

  const { rows } = await query<{ display_name: string; full_name: string; email: string }>(
    `UPDATE organizers o
        SET status           = $2::organizer_status,
            verified_at      = CASE WHEN $2 = 'verified' THEN COALESCE(o.verified_at, now()) ELSE o.verified_at END,
            verified_by      = CASE WHEN $2 = 'verified' THEN $3 ELSE o.verified_by END,
            rejection_reason = CASE WHEN $2 = 'rejected' THEN $4 ELSE NULL END
      FROM users u
      WHERE o.id = $1 AND u.id = o.user_id
      RETURNING o.display_name, u.full_name, u.email`,
    [organizerId, decision, adminId, reason ?? null],
  );
  if (rows.length === 0) throw new NotFoundError('Organizer');

  const contact = rows[0]!;
  return {
    ...(await getKycState(organizerId)),
    organizerId,
    organizerName: contact.display_name,
    contactName: contact.full_name,
    contactEmail: contact.email,
  };
}
