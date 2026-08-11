import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { query, queryOne } from '../../db/pool';
import { BadRequestError, TooManyRequestsError } from '../../utils/errors';
import { generateOtp } from '../../utils/ids';
import { minutesFromNow } from '../../utils/dates';

export type OtpPurpose = 'signup' | 'login' | 'reset_password' | 'verify_email';

interface OtpRow {
  id: string;
  code_hash: string;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
}

/**
 * Issue a one-time code for `identifier`.
 *
 * Any previous unconsumed code for the same identifier/purpose is invalidated
 * first, so requesting a new code reliably makes the old one dead rather than
 * leaving several valid codes in flight.
 *
 * Returns the plaintext code for the caller to deliver by email. It is never
 * stored — only a bcrypt hash goes to the database.
 */
export async function issueOtp(identifier: string, purpose: OtpPurpose): Promise<string> {
  const normalized = identifier.trim().toLowerCase();

  await query(
    `UPDATE otp_codes SET consumed_at = now()
      WHERE identifier = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [normalized, purpose],
  );

  const code = generateOtp(6);
  const codeHash = await bcrypt.hash(code, env.auth.bcryptRounds);

  await query(
    'INSERT INTO otp_codes (identifier, purpose, code_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [normalized, purpose, codeHash, minutesFromNow(env.otp.ttlMinutes)],
  );

  if (!env.isProd) logger.info({ identifier: normalized, purpose, code }, 'OTP issued (development)');
  return code;
}

/**
 * Verify and consume a code.
 *
 * Failed attempts are counted against the stored code; exceeding the limit
 * burns it so an attacker cannot brute-force six digits with unlimited tries.
 */
export async function verifyOtp(identifier: string, purpose: OtpPurpose, code: string): Promise<void> {
  const normalized = identifier.trim().toLowerCase();

  const row = await queryOne<OtpRow>(
    `SELECT id, code_hash, expires_at, attempts, consumed_at
       FROM otp_codes
      WHERE identifier = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalized, purpose],
  );

  if (!row) throw new BadRequestError('Request a new verification code', 'OTP_NOT_FOUND');

  if (row.expires_at.getTime() < Date.now()) {
    await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
    throw new BadRequestError('This code has expired, please request a new one', 'OTP_EXPIRED');
  }

  if (row.attempts >= env.otp.maxAttempts) {
    await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
    throw new TooManyRequestsError('Too many incorrect attempts. Request a new code.');
  }

  const matches = await bcrypt.compare(code, row.code_hash);
  if (!matches) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    const remaining = env.otp.maxAttempts - row.attempts - 1;
    throw new BadRequestError(
      remaining > 0 ? `Incorrect code. ${remaining} attempt(s) remaining.` : 'Incorrect code. Request a new one.',
      'OTP_INVALID',
    );
  }

  await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
}

/** Housekeeping: drop codes that expired more than a day ago. */
export async function purgeExpiredOtps(): Promise<number> {
  const { rowCount } = await query("DELETE FROM otp_codes WHERE expires_at < now() - INTERVAL '1 day'");
  return rowCount ?? 0;
}
