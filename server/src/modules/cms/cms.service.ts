/**
 * CMS accounts: authentication, account administration and the activity trail.
 *
 * Content itself is not handled here — the blog service already owns that, and
 * the CMS calls straight into it rather than growing a second copy of the same
 * queries. What is specific to the CMS is who is allowed in and what they did.
 */
import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { query, queryOne } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../utils/errors';
import { issueCmsSession, revokeAllCmsSessions, signCmsAccessToken, type CmsRole } from './cms.token.service';
import type { CmsCreateUserInput, CmsLoginInput, CmsUpdateUserInput } from './cms.schema';

export interface CmsUser {
  id: string;
  fullName: string;
  email: string;
  role: CmsRole;
  status: 'active' | 'suspended';
  lastLoginAt: string | null;
  createdAt: string;
}

interface CmsUserRow {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  role: CmsRole;
  status: 'active' | 'suspended';
  last_login_at: Date | null;
  created_at: Date;
}

const USER_COLUMNS = 'id, full_name, email, password_hash, role, status, last_login_at, created_at';

function toCmsUser(row: CmsUserRow): CmsUser {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

/* ───────────────────────── authentication ───────────────────────── */

export interface CmsSession {
  user: CmsUser;
  accessToken: string;
  sessionToken: string;
  expiresAt: Date;
}

export async function createCmsSession(
  user: { id: string; email: string; role: CmsRole },
  context: { userAgent?: string; ip?: string },
): Promise<Omit<CmsSession, 'user'>> {
  const accessToken = signCmsAccessToken({ sub: user.id, email: user.email, role: user.role });
  const session = await issueCmsSession(user.id, context);
  await query('UPDATE cms_users SET last_login_at = now() WHERE id = $1', [user.id]);
  return { accessToken, sessionToken: session.token, expiresAt: session.expiresAt };
}

/**
 * Sign in to the CMS.
 *
 * Unlike the storefront's login — which deliberately distinguishes "no such
 * account" from "wrong password" so shoppers can spot a typo — this returns one
 * indistinguishable failure for both. There is no self-service signup here, so
 * a caller has nothing legitimate to learn from the difference, while an
 * attacker would learn which addresses hold publishing rights.
 */
export async function loginCmsUser(input: CmsLoginInput): Promise<CmsUser> {
  const row = await queryOne<CmsUserRow>(`SELECT ${USER_COLUMNS} FROM cms_users WHERE lower(email) = lower($1)`, [
    input.email,
  ]);

  // Still hash on the miss, so the response time does not reveal whether the
  // address exists.
  const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const matches = await bcrypt.compare(input.password, hash);

  if (!row || !matches) {
    throw new UnauthorizedError('Incorrect email or password', 'INVALID_CREDENTIALS');
  }
  if (row.status === 'suspended') {
    throw new ForbiddenError('This CMS account has been suspended', 'ACCOUNT_SUSPENDED');
  }

  return toCmsUser(row);
}

/**
 * Resolve the account behind an access token's subject.
 *
 * Re-read on every request rather than trusted from the token body, so removing
 * someone's access takes effect immediately instead of whenever their token
 * happens to expire.
 */
export async function getActiveCmsUser(id: string): Promise<CmsUser> {
  const row = await queryOne<CmsUserRow>(`SELECT ${USER_COLUMNS} FROM cms_users WHERE id = $1`, [id]);
  if (!row) throw new UnauthorizedError('This CMS account no longer exists', 'ACCOUNT_MISSING');
  if (row.status === 'suspended') {
    throw new ForbiddenError('This CMS account has been suspended', 'ACCOUNT_SUSPENDED');
  }
  return toCmsUser(row);
}

export async function changeCmsPassword(
  id: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM cms_users WHERE id = $1', [id]);
  if (!row) throw new NotFoundError('Account');

  const matches = await bcrypt.compare(input.currentPassword, row.password_hash);
  if (!matches) throw new UnauthorizedError('Your current password is incorrect', 'INVALID_CREDENTIALS');

  await query('UPDATE cms_users SET password_hash = $2 WHERE id = $1', [
    id,
    await bcrypt.hash(input.newPassword, env.auth.bcryptRounds),
  ]);
  // A changed password must invalidate sessions that may already be stolen.
  await revokeAllCmsSessions(id);
}

/* ──────────────────────── account management ──────────────────────── */

export async function listCmsUsers(): Promise<CmsUser[]> {
  const { rows } = await query<CmsUserRow>(
    `SELECT ${USER_COLUMNS} FROM cms_users ORDER BY created_at ASC`,
  );
  return rows.map(toCmsUser);
}

export async function createCmsUser(input: CmsCreateUserInput): Promise<CmsUser> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM cms_users WHERE lower(email) = lower($1)', [
    input.email,
  ]);
  if (existing) throw new ConflictError('A CMS account with this email already exists', 'EMAIL_TAKEN');

  const row = await queryOne<CmsUserRow>(
    `INSERT INTO cms_users (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING ${USER_COLUMNS}`,
    [input.fullName, input.email, await bcrypt.hash(input.password, env.auth.bcryptRounds), input.role],
  );
  return toCmsUser(row!);
}

export async function updateCmsUser(id: string, input: CmsUpdateUserInput, actorId: string): Promise<CmsUser> {
  const target = await queryOne<CmsUserRow>(`SELECT ${USER_COLUMNS} FROM cms_users WHERE id = $1`, [id]);
  if (!target) throw new NotFoundError('Account');

  // Losing the last admin would leave nobody able to create accounts, and the
  // only way back would be the command line. The same applies to an admin
  // demoting or suspending themselves by accident.
  if (target.role === 'admin' && (input.role === 'editor' || input.status === 'suspended')) {
    await assertNotLastAdmin(id);
  }
  if (id === actorId && input.status === 'suspended') {
    throw new BadRequestError('You cannot suspend your own account', 'CANNOT_SUSPEND_SELF');
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.fullName !== undefined) {
    params.push(input.fullName);
    sets.push(`full_name = $${params.length}`);
  }
  if (input.role !== undefined) {
    params.push(input.role);
    sets.push(`role = $${params.length}`);
  }
  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }
  if (input.password !== undefined) {
    params.push(await bcrypt.hash(input.password, env.auth.bcryptRounds));
    sets.push(`password_hash = $${params.length}`);
  }

  if (sets.length === 0) return toCmsUser(target);

  params.push(id);
  const row = await queryOne<CmsUserRow>(
    `UPDATE cms_users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${USER_COLUMNS}`,
    params,
  );

  // A reset password or a suspension has to end the sessions that are already
  // open, or the change does not take effect until they expire on their own.
  if (input.password !== undefined || input.status === 'suspended') {
    await revokeAllCmsSessions(id);
  }

  return toCmsUser(row!);
}

export async function deleteCmsUser(id: string, actorId: string): Promise<void> {
  if (id === actorId) throw new BadRequestError('You cannot delete your own account', 'CANNOT_DELETE_SELF');

  const target = await queryOne<{ role: CmsRole }>('SELECT role FROM cms_users WHERE id = $1', [id]);
  if (!target) throw new NotFoundError('Account');
  if (target.role === 'admin') await assertNotLastAdmin(id);

  await query('DELETE FROM cms_users WHERE id = $1', [id]);
}

async function assertNotLastAdmin(excludingId: string): Promise<void> {
  const row = await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM cms_users
      WHERE role = 'admin' AND status = 'active' AND id <> $1`,
    [excludingId],
  );
  if ((row?.count ?? 0) === 0) {
    throw new ConflictError(
      'This is the only active CMS admin — promote someone else first',
      'LAST_ADMIN',
    );
  }
}

/* ───────────────────────── activity trail ───────────────────────── */

export interface CmsActivityEntry {
  actor: { id: string; email: string };
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Append to the CMS trail. Observability, never business logic: a failure here
 * is logged and swallowed rather than failing the action it was recording.
 */
export async function recordActivity(entry: CmsActivityEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO cms_activity (cms_user_id, actor_email, action, entity_type, entity_id, summary, metadata, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        entry.actor.id,
        entry.actor.email,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.summary ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.ip ?? null,
      ],
    );
  } catch (err) {
    logger.warn({ err, action: entry.action }, 'Failed to write CMS activity log');
  }
}

export interface CmsActivityRecord {
  id: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  createdAt: string;
}

export async function listActivity(limit = 10): Promise<CmsActivityRecord[]> {
  const { rows } = await query<{
    id: string;
    actor_email: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    summary: string | null;
    created_at: Date;
  }>(
    `SELECT id, actor_email, action, entity_type, entity_id, summary, created_at
       FROM cms_activity
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    actorEmail: row.actor_email,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
  }));
}
