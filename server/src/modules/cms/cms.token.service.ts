/**
 * Tokens for the CMS, minted and verified independently of the platform's.
 *
 * Same two-token shape as `auth/token.service` — a short-lived signed access
 * token plus an opaque, hashed, rotating session token — but with its own
 * secret, its own issuer/audience pair and its own table. That combination is
 * what makes a platform token useless here and a CMS token useless there, with
 * no shared state to keep in step.
 */
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import { query, queryOne } from '../../db/pool';
import { sha256 } from '../../utils/signing';
import { randomToken } from '../../utils/ids';
import { UnauthorizedError } from '../../utils/errors';
import { parseDuration } from '../auth/token.service';

export type CmsRole = 'admin' | 'editor';

export interface CmsAccessTokenPayload {
  sub: string;
  email: string;
  role: CmsRole;
}

// Deliberately different from the platform's 'evento' / 'evento-api'. jwt.verify
// checks both, so a token minted for the storefront cannot be replayed here even
// if the two secrets were ever accidentally set to the same value.
const ISSUER = 'tixit-cms';
const AUDIENCE = 'tixit-cms-api';

export function signCmsAccessToken(payload: CmsAccessTokenPayload): string {
  return jwt.sign(payload, env.cms.accessSecret, {
    expiresIn: env.cms.accessTtl,
    issuer: ISSUER,
    audience: AUDIENCE,
  } as SignOptions);
}

export function verifyCmsAccessToken(token: string): CmsAccessTokenPayload {
  try {
    return jwt.verify(token, env.cms.accessSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as CmsAccessTokenPayload;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw new UnauthorizedError(
      expired ? 'Your CMS session has expired, please sign in again' : 'Invalid CMS authentication token',
      expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    );
  }
}

export async function issueCmsSession(
  cmsUserId: string,
  context: { userAgent?: string; ip?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + parseDuration(env.cms.sessionTtl));

  await query(
    `INSERT INTO cms_sessions (cms_user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [cmsUserId, sha256(token), expiresAt, context.userAgent ?? null, context.ip ?? null],
  );

  return { token, expiresAt };
}

interface CmsSessionRow {
  id: string;
  cms_user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/**
 * Validate a session token and rotate it, so a stolen token is usable at most
 * once and the theft surfaces as a failed refresh rather than staying silent.
 */
export async function rotateCmsSession(
  token: string,
  context: { userAgent?: string; ip?: string } = {},
): Promise<{ cmsUserId: string; token: string; expiresAt: Date }> {
  const row = await queryOne<CmsSessionRow>(
    'SELECT id, cms_user_id, expires_at, revoked_at FROM cms_sessions WHERE token_hash = $1',
    [sha256(token)],
  );

  if (!row) throw new UnauthorizedError('Invalid session', 'REFRESH_INVALID');
  if (row.revoked_at) throw new UnauthorizedError('This session has been signed out', 'REFRESH_REVOKED');
  if (row.expires_at.getTime() < Date.now()) {
    throw new UnauthorizedError('Your CMS session has expired, please sign in again', 'REFRESH_EXPIRED');
  }

  await query('UPDATE cms_sessions SET revoked_at = now() WHERE id = $1', [row.id]);
  const next = await issueCmsSession(row.cms_user_id, context);
  return { cmsUserId: row.cms_user_id, ...next };
}

export async function revokeCmsSession(token: string): Promise<void> {
  await query('UPDATE cms_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    sha256(token),
  ]);
}

/** Sign a CMS account out everywhere — used on password change and suspension. */
export async function revokeAllCmsSessions(cmsUserId: string): Promise<void> {
  await query('UPDATE cms_sessions SET revoked_at = now() WHERE cms_user_id = $1 AND revoked_at IS NULL', [
    cmsUserId,
  ]);
}
