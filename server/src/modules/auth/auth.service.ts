import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { query, queryOne, withTransaction } from '../../db/pool';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../../utils/errors';
import { uniqueSlug } from '../../utils/ids';
import { hoursFromNow } from '../../utils/dates';
import { sendMailAsync } from '../../services/mail.service';
import { audit } from '../../services/audit.service';
import type { Role } from '../../middleware/auth';
import { issueOtp, verifyOtp, type OtpPurpose } from './otp.service';
import { issueRefreshToken, revokeAllForUser, signAccessToken } from './token.service';
import type { ChangePasswordInput, LoginInput, RegisterInput, UpdateProfileInput } from './auth.schema';

export interface PublicUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  status: string;
  avatarUrl: string | null;
  cityId: string | null;
  emailVerified: boolean;
  createdAt: Date;
  organizer?: { id: string; displayName: string; slug: string; status: string } | null;
}

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  password_hash: string | null;
  role: Role;
  status: 'active' | 'suspended' | 'deleted';
  avatar_url: string | null;
  city_id: string | null;
  email_verified_at: Date | null;
  created_at: Date;
  organizer_id?: string | null;
  organizer_name?: string | null;
  organizer_slug?: string | null;
  organizer_status?: string | null;
}

const USER_SELECT = `
  SELECT u.id, u.full_name, u.email, u.phone, u.password_hash, u.role, u.status,
         u.avatar_url, u.city_id, u.email_verified_at, u.created_at,
         o.id AS organizer_id, o.display_name AS organizer_name,
         o.slug AS organizer_slug, o.status AS organizer_status
    FROM users u
    LEFT JOIN organizers o ON o.user_id = u.id`;

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    avatarUrl: row.avatar_url,
    cityId: row.city_id,
    emailVerified: row.email_verified_at !== null,
    createdAt: row.created_at,
    organizer: row.organizer_id
      ? {
          id: row.organizer_id,
          displayName: row.organizer_name ?? '',
          slug: row.organizer_slug ?? '',
          status: row.organizer_status ?? 'pending',
        }
      : null,
  };
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * How long a submitted-but-unverified signup is kept.
 *
 * Comfortably longer than the OTP itself (minutes), so someone who comes back
 * the next morning can ask for a fresh code instead of retyping the form.
 */
const PENDING_REGISTRATION_TTL_HOURS = 24;

interface PendingRegistrationRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  role: 'customer' | 'organizer';
  organizer_name: string | null;
}

/** Expired rows are treated as absent; the purge job clears them out later. */
async function findPendingRegistration(email: string): Promise<PendingRegistrationRow | null> {
  return queryOne<PendingRegistrationRow>(
    `SELECT id, full_name, email, phone, password_hash, role, organizer_name
       FROM pending_registrations
      WHERE lower(email) = lower($1) AND expires_at > now()`,
    [email],
  );
}

/** Housekeeping: drop signups that were started and never verified. */
export async function purgeExpiredRegistrations(): Promise<number> {
  const { rowCount } = await query('DELETE FROM pending_registrations WHERE expires_at < now()');
  return rowCount ?? 0;
}

export async function createSession(
  user: { id: string; email: string; role: Role },
  context: { userAgent?: string; ip?: string },
): Promise<SessionTokens> {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
  const refresh = await issueRefreshToken(user.id, context);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return { accessToken, refreshToken: refresh.token, expiresAt: refresh.expiresAt };
}

/**
 * Start a registration.
 *
 * Verification is mandatory, so this creates no account. The submitted details
 * are parked in `pending_registrations` and a code is emailed; the `users` row
 * is created only when that code comes back (see `completeRegistration`). An
 * address nobody can read mail for therefore never becomes an account.
 */
export async function register(
  input: RegisterInput,
  context: { ip?: string },
): Promise<{ email: string; otpSent: boolean; devOtp?: string }> {
  // Email is the only channel that can prove ownership, so with verification
  // mandatory a signup cannot even be started without a mail provider. Better
  // to say so than to accept the form and strand the person waiting for a code
  // that was never going to arrive.
  if (env.isProd && !env.mail.enabled) {
    throw new ServiceUnavailableError(
      'Registration is temporarily unavailable. Please try again shortly.',
      'MAIL_UNAVAILABLE',
    );
  }

  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [input.email]);
  if (existing) throw new ConflictError('An account with this email already exists', 'EMAIL_TAKEN');

  if (input.phone) {
    const phoneTaken = await queryOne<{ id: string }>('SELECT id FROM users WHERE phone = $1', [input.phone]);
    if (phoneTaken) throw new ConflictError('An account with this phone number already exists', 'PHONE_TAKEN');
  }

  const passwordHash = await bcrypt.hash(input.password, env.auth.bcryptRounds);

  // Registering the same address again before verifying replaces the earlier
  // attempt. Nothing about it was ever proven, and keeping both would leave a
  // stale name/password that a later code could still claim.
  await withTransaction(async (client) => {
    await client.query('DELETE FROM pending_registrations WHERE lower(email) = lower($1)', [input.email]);
    await client.query(
      `INSERT INTO pending_registrations (full_name, email, phone, password_hash, role, organizer_name, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.fullName,
        input.email,
        input.phone ?? null,
        passwordHash,
        input.role,
        input.role === 'organizer' ? (input.organizerName?.trim() || input.fullName) : null,
        hoursFromNow(PENDING_REGISTRATION_TTL_HOURS),
      ],
    );
  });

  const code = await issueOtp(input.email, 'signup');
  sendMailAsync({
    to: input.email,
    template: 'otp',
    data: { name: input.fullName, code, purpose: OTP_PURPOSE_COPY.signup, ttlMinutes: env.otp.ttlMinutes },
    // No user row exists yet, so the notification cannot be attributed to one.
    userId: null,
  });

  await audit({
    action: 'user.registration_started',
    entityType: 'user',
    metadata: { email: input.email, role: input.role },
    ip: context.ip,
  });

  return {
    email: input.email,
    otpSent: true,
    ...(env.otp.devEcho ? { devOtp: code } : {}),
  };
}

/**
 * Finish a registration by redeeming the emailed code.
 *
 * This is where the account is actually created. When role = organizer the
 * user row and the organizer profile are created in one transaction, so a
 * failure can never leave a user who is nominally an organizer but has no
 * organizer record for the dashboard to load.
 */
async function completeRegistration(email: string, code: string, context: { ip?: string }): Promise<UserRow> {
  const pending = await findPendingRegistration(email);
  if (!pending) {
    throw new BadRequestError(
      'That signup has expired or was already completed. Please register again.',
      'REGISTRATION_NOT_FOUND',
    );
  }

  // Check for a clash before redeeming, so a duplicate does not also burn the
  // one-time code and force the person through a pointless resend.
  const taken = await queryOne<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (taken) {
    await query('DELETE FROM pending_registrations WHERE id = $1', [pending.id]);
    throw new ConflictError('An account with this email already exists', 'EMAIL_TAKEN');
  }

  await verifyOtp(email, 'signup', code);

  const created = await withTransaction(async (client) => {
    const { rows } = await client.query<UserRow>(
      `INSERT INTO users (full_name, email, phone, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id, full_name, email, phone, password_hash, role, status, avatar_url, city_id, email_verified_at, created_at`,
      [pending.full_name, pending.email, pending.phone, pending.password_hash, pending.role],
    );
    const userRow = rows[0]!;

    if (pending.role === 'organizer') {
      const displayName = pending.organizer_name?.trim() || pending.full_name;
      const { rows: orgRows } = await client.query<{ id: string; display_name: string; slug: string; status: string }>(
        `INSERT INTO organizers (user_id, display_name, slug, support_email, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id, display_name, slug, status`,
        [userRow.id, displayName, uniqueSlug(displayName), pending.email],
      );
      const org = orgRows[0]!;
      userRow.organizer_id = org.id;
      userRow.organizer_name = org.display_name;
      userRow.organizer_slug = org.slug;
      userRow.organizer_status = org.status;
    }

    await client.query('DELETE FROM pending_registrations WHERE id = $1', [pending.id]);
    return userRow;
  });

  sendMailAsync({
    to: created.email,
    template: 'welcome',
    data: { name: created.full_name },
    userId: created.id,
  });

  await audit({
    actorId: created.id,
    actorRole: created.role,
    action: 'user.registered',
    entityType: 'user',
    entityId: created.id,
    metadata: { role: created.role },
    ip: context.ip,
  });

  return created;
}

export async function login(input: LoginInput): Promise<UserRow> {
  const row = await queryOne<UserRow>(`${USER_SELECT} WHERE lower(u.email) = lower($1)`, [input.email]);

  // Always run a bcrypt comparison, even when no user exists, so response time
  // does not reveal whether an email is registered.
  const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const matches = await bcrypt.compare(input.password, hash);

  if (!row || !row.password_hash || !matches) {
    // A signup that was started but never verified has no user row, so it
    // would otherwise fail as "incorrect password" forever with no hint about
    // what to do. Only say so when the supplied password actually matches the
    // pending attempt — that discloses nothing the caller did not already
    // know, so it is not an account-enumeration oracle.
    const pending = await findPendingRegistration(input.email);
    if (pending && (await bcrypt.compare(input.password, pending.password_hash))) {
      throw new ForbiddenError(
        'Verify your email to finish creating your account',
        'EMAIL_NOT_VERIFIED',
      );
    }
    throw new UnauthorizedError('Incorrect email or password', 'INVALID_CREDENTIALS');
  }
  if (row.status === 'suspended') throw new ForbiddenError('This account has been suspended', 'ACCOUNT_SUSPENDED');
  if (row.status === 'deleted') throw new UnauthorizedError('Incorrect email or password', 'INVALID_CREDENTIALS');

  return row;
}

const OTP_PURPOSE_COPY: Record<OtpPurpose, string> = {
  login: 'sign in',
  signup: 'verify your email',
  verify_email: 'verify your email',
  reset_password: 'reset your password',
};

/** Send a one-time code. Never reveals whether the address is registered. */
export async function requestOtp(
  email: string,
  purpose: OtpPurpose,
): Promise<{ sent: boolean; devOtp?: string }> {
  // A signup code belongs to a pending registration, not to an account — the
  // account does not exist yet. Resending is also the only way back into an
  // interrupted signup, so it refreshes the pending row's lifetime.
  if (purpose === 'signup') {
    const pending = await findPendingRegistration(email);
    // Silent success both avoids confirming which addresses have a signup in
    // flight and stops the endpoint being used to mail arbitrary strangers.
    if (!pending) return { sent: true };

    await query('UPDATE pending_registrations SET expires_at = $2 WHERE id = $1', [
      pending.id,
      hoursFromNow(PENDING_REGISTRATION_TTL_HOURS),
    ]);

    const signupCode = await issueOtp(email, 'signup');
    sendMailAsync({
      to: email,
      template: 'otp',
      data: {
        name: pending.full_name,
        code: signupCode,
        purpose: OTP_PURPOSE_COPY.signup,
        ttlMinutes: env.otp.ttlMinutes,
      },
      userId: null,
    });

    return { sent: true, ...(env.otp.devEcho ? { devOtp: signupCode } : {}) };
  }

  const row = await queryOne<{ id: string; full_name: string; email_verified_at: Date | null }>(
    'SELECT id, full_name, email_verified_at FROM users WHERE lower(email) = lower($1) AND status = \'active\'',
    [email],
  );

  // For login/reset the account must exist; we return success regardless to
  // avoid turning this endpoint into an account-enumeration oracle.
  if (!row) return { sent: true };

  // Nothing to confirm on an address that is already verified — skip the send
  // rather than mailing a code that would do nothing.
  if (purpose === 'verify_email' && row?.email_verified_at) return { sent: true };

  const code = await issueOtp(email, purpose);
  sendMailAsync({
    to: email,
    template: 'otp',
    data: {
      name: row?.full_name,
      code,
      purpose: OTP_PURPOSE_COPY[purpose],
      ttlMinutes: env.otp.ttlMinutes,
    },
    userId: row?.id ?? null,
  });

  return { sent: true, ...(env.otp.devEcho ? { devOtp: code } : {}) };
}

/**
 * Verify a code and apply its side effect.
 *
 *  signup           → creates the account the pending registration describes
 *  login            → returns the user so the caller can mint a session
 *  verify_email     → marks the address verified
 *  reset_password   → sets a new password and revokes every existing session
 */
export async function verifyOtpAndResolve(
  input: {
    email: string;
    code: string;
    purpose: OtpPurpose;
    newPassword?: string;
  },
  context: { ip?: string } = {},
): Promise<UserRow> {
  // Signup is the one purpose with no user to look up — it creates one.
  if (input.purpose === 'signup') return completeRegistration(input.email, input.code, context);

  await verifyOtp(input.email, input.purpose, input.code);

  const row = await queryOne<UserRow>(`${USER_SELECT} WHERE lower(u.email) = lower($1)`, [input.email]);
  if (!row) throw new NotFoundError('Account');
  if (row.status === 'suspended') throw new ForbiddenError('This account has been suspended', 'ACCOUNT_SUSPENDED');

  if (input.purpose === 'reset_password') {
    if (!input.newPassword) throw new BadRequestError('Provide a new password', 'PASSWORD_REQUIRED');
    const hash = await bcrypt.hash(input.newPassword, env.auth.bcryptRounds);
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [row.id, hash]);
    await revokeAllForUser(row.id);
  }

  if (row.email_verified_at === null) {
    await query('UPDATE users SET email_verified_at = now() WHERE id = $1', [row.id]);
    row.email_verified_at = new Date();
  }

  return row;
}

export async function getUserById(userId: string): Promise<PublicUser> {
  const row = await queryOne<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [userId]);
  if (!row) throw new NotFoundError('User');
  return toPublicUser(row);
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
  if (input.phone) {
    const taken = await queryOne<{ id: string }>('SELECT id FROM users WHERE phone = $1 AND id <> $2', [
      input.phone,
      userId,
    ]);
    if (taken) throw new ConflictError('An account with this phone number already exists', 'PHONE_TAKEN');
  }

  await query(
    `UPDATE users SET
       full_name  = COALESCE($2, full_name),
       phone      = COALESCE($3, phone),
       avatar_url = COALESCE($4, avatar_url),
       city_id    = COALESCE($5, city_id)
     WHERE id = $1`,
    [userId, input.fullName ?? null, input.phone ?? null, input.avatarUrl ?? null, input.cityId ?? null],
  );

  return getUserById(userId);
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const row = await queryOne<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = $1', [
    userId,
  ]);
  if (!row) throw new NotFoundError('User');
  if (!row.password_hash) throw new BadRequestError('This account signs in with a one-time code', 'NO_PASSWORD_SET');

  const matches = await bcrypt.compare(input.currentPassword, row.password_hash);
  if (!matches) throw new UnauthorizedError('Your current password is incorrect', 'INVALID_CREDENTIALS');

  const hash = await bcrypt.hash(input.newPassword, env.auth.bcryptRounds);
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hash]);
  // Changing a password must invalidate sessions that may already be stolen.
  await revokeAllForUser(userId);
}

export { USER_SELECT };
export type { UserRow };
