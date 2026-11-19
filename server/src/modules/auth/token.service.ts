import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import { query, queryOne, withTransaction, type Queryable } from '../../db/pool';
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
 *
 * Each token belongs to a family — the chain produced by rotating the token
 * issued at sign-in (see migration 0019). Pass `familyId` to continue a chain.
 */
export async function issueRefreshToken(
  userId: string,
  context: { userAgent?: string; ip?: string; familyId?: string } = {},
  client: Queryable = { query },
): Promise<{ id: string; token: string; expiresAt: Date; familyId: string }> {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + parseDuration(env.auth.refreshTtl));

  const { rows } = await client.query<{ id: string; family_id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip, family_id)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::uuid, gen_random_uuid()))
     RETURNING id, family_id`,
    [userId, sha256(token), expiresAt, context.userAgent ?? null, context.ip ?? null, context.familyId ?? null],
  );

  // A fresh sign-in starts its own family; make the id self-referential so a
  // family can always be found from any of its members.
  const row = rows[0]!;
  return { id: row.id, token, expiresAt, familyId: row.family_id };
}

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoke_reason: string | null;
}

/**
 * Validate a refresh token and rotate it.
 *
 * Rotation makes a stolen token usable at most once. Three outcomes:
 *
 *  1. Live token → it is retired and a successor in the same family issued.
 *  2. Token rotated within the grace window → a sibling is issued. This is the
 *     benign race of two tabs, or www and dine-in, refreshing together; the
 *     conditional UPDATE below decides the winner atomically, so concurrent
 *     callers can never both "win" and neither is signed out.
 *  3. Token rotated longer ago → a replay. The whole family is revoked, which
 *     signs out every holder, attacker included.
 */
export async function rotateRefreshToken(
  token: string,
  context: { userAgent?: string; ip?: string } = {},
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<RefreshRow>(
      `SELECT id, user_id, family_id, expires_at, revoked_at, revoke_reason
         FROM refresh_tokens WHERE token_hash = $1`,
      [sha256(token)],
    );
    const row = rows[0];

    if (!row) throw new UnauthorizedError('Invalid refresh token', 'REFRESH_INVALID');
    if (row.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedError('Your session has expired, please sign in again', 'REFRESH_EXPIRED');
    }

    const next = () =>
      issueRefreshToken(row.user_id, { ...context, familyId: row.family_id }, client).then((issued) => ({
        userId: row.user_id,
        token: issued.token,
        expiresAt: issued.expiresAt,
        id: issued.id,
      }));

    if (!row.revoked_at) {
      const issued = await next();
      const retired = await client.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'rotated', replaced_by = $2
          WHERE id = $1 AND revoked_at IS NULL`,
        [row.id, issued.id],
      );
      // Lost the race to a concurrent refresh of the same token: that caller
      // retired it a moment ago, which is exactly the grace-window case.
      if (retired.rowCount === 0) await assertWithinGrace(client, row.id, row.family_id);
      return { userId: issued.userId, token: issued.token, expiresAt: issued.expiresAt };
    }

    if (row.revoke_reason !== 'rotated') {
      throw new UnauthorizedError('This session has been signed out', 'REFRESH_REVOKED');
    }

    await assertWithinGrace(client, row.id, row.family_id);
    const issued = await next();
    return { userId: issued.userId, token: issued.token, expiresAt: issued.expiresAt };
  });
}

/**
 * Allow a rotated token to be reused only for a few seconds after rotation and
 * only while its family is still alive; otherwise treat it as theft.
 */
async function assertWithinGrace(client: Queryable, tokenId: string, familyId: string): Promise<void> {
  const { rows } = await client.query<{ within: boolean; family_alive: boolean }>(
    `SELECT t.revoked_at > now() - make_interval(secs => $3) AS within,
            EXISTS (SELECT 1 FROM refresh_tokens f WHERE f.family_id = $2 AND f.revoked_at IS NULL) AS family_alive
       FROM refresh_tokens t WHERE t.id = $1`,
    [tokenId, familyId, env.auth.refreshReuseGraceSeconds],
  );
  const state = rows[0];
  if (state?.within && state.family_alive) return;

  // Outside the window: a replay. Commit the revocation even though we throw,
  // so it is done on a separate connection rather than this transaction.
  await revokeFamily(familyId, 'reuse');
  throw new UnauthorizedError('This session is no longer valid, please sign in again', 'REFRESH_REUSED');
}

async function revokeFamily(familyId: string, reason: 'reuse' | 'logout'): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = $2
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, reason],
  );
}

/** Sign out one session — the whole family, so a sibling minted in a race dies too. */
export async function revokeRefreshToken(token: string): Promise<void> {
  const row = await queryOne<{ family_id: string }>('SELECT family_id FROM refresh_tokens WHERE token_hash = $1', [
    sha256(token),
  ]);
  if (row) await revokeFamily(row.family_id, 'logout');
}

/** Sign the user out of every device (used on password change). */
export async function revokeAllForUser(userId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'password_change'
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
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
