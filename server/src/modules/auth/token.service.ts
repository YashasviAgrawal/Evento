import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import { query, queryOne } from '../../db/pool';
import { sha256 } from '../../utils/signing';
import { randomToken } from '../../utils/ids';
import { UnauthorizedError } from '../../utils/errors';
import type { Role } from '../../middleware/auth';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  email: string;
}

const ISSUER = 'evento';
const AUDIENCE = 'evento-api';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.auth.accessSecret, {
    expiresIn: env.auth.accessTtl,
    issuer: ISSUER,
    audience: AUDIENCE,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.auth.accessSecret, { issuer: ISSUER, audience: AUDIENCE }) as AccessTokenPayload;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw new UnauthorizedError(
      expired ? 'Your session has expired, please sign in again' : 'Invalid authentication token',
      expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    );
  }
}

/**
 * Refresh tokens are opaque random strings, not JWTs.
 *
 * Only their SHA-256 hash is persisted, so a database leak cannot be replayed
 * as a valid session, and revocation is a single UPDATE rather than a
 * blocklist of still-valid signatures.
 */
export async function issueRefreshToken(
  userId: string,
  context: { userAgent?: string; ip?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + parseDuration(env.auth.refreshTtl));

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, sha256(token), expiresAt, context.userAgent ?? null, context.ip ?? null],
  );

  return { token, expiresAt };
}

interface RefreshRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/**
 * Validate a refresh token and rotate it.
 *
 * Rotation means a stolen token is usable at most once; the legitimate client
 * then fails to refresh, which surfaces the compromise instead of hiding it.
 */
export async function rotateRefreshToken(
  token: string,
  context: { userAgent?: string; ip?: string } = {},
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  const row = await queryOne<RefreshRow>(
    'SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1',
    [sha256(token)],
  );

  if (!row) throw new UnauthorizedError('Invalid refresh token', 'REFRESH_INVALID');
  if (row.revoked_at) throw new UnauthorizedError('This session has been signed out', 'REFRESH_REVOKED');
  if (row.expires_at.getTime() < Date.now()) {
    throw new UnauthorizedError('Your session has expired, please sign in again', 'REFRESH_EXPIRED');
  }

  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
  const next = await issueRefreshToken(row.user_id, context);
  return { userId: row.user_id, ...next };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    sha256(token),
  ]);
}

/** Sign the user out of every device (used on password change). */
export async function revokeAllForUser(userId: string): Promise<void> {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

/** Parse "15m" / "30d" / "24h" / "3600" into milliseconds. */
export function parseDuration(input: string): number {
  const match = /^(\d+)\s*([smhd])?$/i.exec(input.trim());
  if (!match) throw new Error(`Invalid duration: ${input}`);
  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] ?? 1000);
}
