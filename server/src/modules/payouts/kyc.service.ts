import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../utils/errors';

/**
 * Organizer KYC.
 *
 * An organizer cannot be paid until the finance team knows who they are and
 * where the money should go, so these details are collected once at signup and
 * reviewed by an admin. The record is the source of truth for payouts; the
 * matching identity fields on `organizers` (gstin, pan, address) are kept in
 * step on submission so the profile screens that already read them do not show
 * something different from what finance is working with.
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
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: Date;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  reviewedBy: { id: string; fullName: string } | null;
}

/** What the organizer's own screens see: the record, or why there isn't one. */
export interface KycState {
  status: 'not_submitted' | 'pending' | 'approved' | 'rejected';
  /** Approved KYC is what unlocks payouts, so callers gate on this one flag. */
  payoutsEnabled: boolean;
  kyc: KycRecord | null;
}

/** Last four digits only — enough to recognise an account, not to use it. */
export function maskAccountNumber(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

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
    status: row.status as KycRecord['status'],
    submittedAt: row.submitted_at as Date,
    reviewedAt: (row.reviewed_at as Date | null) ?? null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    reviewedBy: row.reviewer_id
      ? { id: row.reviewer_id as string, fullName: (row.reviewer_name as string | null) ?? '' }
      : null,
  };
}

const SELECT_KYC = `
  SELECT k.*, r.id AS reviewer_id, r.full_name AS reviewer_name
    FROM organizer_kyc k
    LEFT JOIN users r ON r.id = k.reviewed_by`;

export async function getKyc(organizerId: string): Promise<KycRecord | null> {
  const row = await queryOne(`${SELECT_KYC} WHERE k.organizer_id = $1`, [organizerId]);
  return row ? mapKyc(row) : null;
}

export async function getKycState(organizerId: string): Promise<KycState> {
  const kyc = await getKyc(organizerId);
  return {
    status: kyc?.status ?? 'not_submitted',
    payoutsEnabled: kyc?.status === 'approved',
    kyc,
  };
}

/**
 * Submit — or resubmit after a rejection — the organizer's KYC.
 *
 * Approved details are frozen: correcting a bank account an admin has already
 * signed off on is a review decision, not a self-service edit, so the admin has
 * to reopen it first. Anything else is an upsert that puts the record back into
 * the review queue.
 */
export async function submitKyc(organizerId: string, input: KycInput): Promise<KycRecord> {
  return withTransaction(async (client) => {
    const existing = await client.query<{ status: string }>(
      'SELECT status FROM organizer_kyc WHERE organizer_id = $1 FOR UPDATE',
      [organizerId],
    );
    if (existing.rows[0]?.status === 'approved') {
      throw new ConflictError(
        'Your KYC is already approved. Contact support to change your payout details.',
        'KYC_LOCKED',
      );
    }

    const inserted = await client.query(
      `INSERT INTO organizer_kyc (organizer_id, legal_name, pan, business_name, gstin, business_address,
                                  account_holder_name, account_number, ifsc, bank_name,
                                  status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', now())
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
         status              = 'pending',
         submitted_at        = now(),
         reviewed_at         = NULL,
         reviewed_by         = NULL,
         rejection_reason    = NULL
       RETURNING id`,
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

    // Keep the profile copies of the same facts in step, so the settings page
    // and the admin organizer report never contradict the KYC record.
    await client.query(
      `UPDATE organizers
          SET pan = $2, gstin = COALESCE($3, gstin), address = $4
        WHERE id = $1`,
      [organizerId, input.pan, input.gstin ?? null, input.businessAddress],
    );

    // Read back on the transaction's own connection — the row is not visible
    // to the pool until this commits.
    const { rows } = await client.query(`${SELECT_KYC} WHERE k.id = $1`, [inserted.rows[0]!.id]);
    return mapKyc(rows[0]!);
  });
}

export interface KycReviewResult extends KycRecord {
  organizerName: string;
  contactName: string;
  contactEmail: string;
}

/**
 * Admin review. `approved` unlocks payouts; `rejected` sends it back to the
 * organizer with a reason, and `pending` reopens an approved record so the
 * organizer can correct details they are otherwise locked out of.
 */
export async function reviewKyc(
  organizerId: string,
  decision: 'approved' | 'rejected' | 'pending',
  adminId: string,
  reason?: string | null,
): Promise<KycReviewResult> {
  const { rows } = await query(
    `UPDATE organizer_kyc k
        SET status           = $2::kyc_status,
            reviewed_at      = now(),
            reviewed_by      = $3,
            rejection_reason = $4
      WHERE k.organizer_id = $1
      RETURNING k.id`,
    [organizerId, decision, adminId, decision === 'rejected' ? (reason ?? null) : null],
  );
  if (rows.length === 0) throw new NotFoundError('KYC submission');

  const row = await queryOne(
    `SELECT k.*, r.id AS reviewer_id, r.full_name AS reviewer_name,
            o.display_name, u.full_name AS contact_name, u.email AS contact_email
       FROM organizer_kyc k
       LEFT JOIN users r ON r.id = k.reviewed_by
       JOIN organizers o ON o.id = k.organizer_id
       JOIN users u      ON u.id = o.user_id
      WHERE k.id = $1`,
    [rows[0]!.id],
  );

  return {
    ...mapKyc(row!),
    organizerName: row!.display_name as string,
    contactName: row!.contact_name as string,
    contactEmail: row!.contact_email as string,
  };
}
