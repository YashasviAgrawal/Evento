/**
 * Create or update a CMS account from the command line.
 *
 * The CMS has no public sign-up — that is the point of it being a separate
 * credential space — so the first account has to come from somewhere outside
 * the CMS itself. After that, an existing CMS admin can create the rest from
 * Settings → Accounts, and this script stays available for the day someone
 * locks themselves out of the only admin account.
 *
 *   npm run cms:user -- --email you@example.com --name "Your Name"
 *   npm run cms:user -- --email you@example.com --name "Your Name" --role editor
 *   npm run cms:user -- --email you@example.com --password 'correct horse 42'
 *
 * With no --password, one is generated and printed once. Re-running for an
 * address that already has an account resets that account's password and
 * revokes its open sessions rather than failing.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { closePool, query, queryOne } from './pool';

interface Args {
  email?: string;
  name?: string;
  role?: string;
  password?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag?.startsWith('--')) continue;
    const key = flag.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) continue;
    if (key === 'email' || key === 'name' || key === 'role' || key === 'password') {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

/**
 * A generated password has to survive being copied out of a terminal and
 * pasted into a browser, so it avoids the characters that get mangled or
 * misread on the way (quotes, backslashes, and the 0/O, 1/l family).
 */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  // Guarantees the digit the CMS password rules require, wherever the random
  // draw landed.
  return `${out}7`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email) {
    throw new Error('Provide --email, e.g. npm run cms:user -- --email you@example.com --name "Your Name"');
  }
  if (!args.email.includes('@')) throw new Error(`"${args.email}" does not look like an email address`);

  const role = args.role ?? 'admin';
  if (role !== 'admin' && role !== 'editor') throw new Error(`--role must be "admin" or "editor", got "${role}"`);

  const password = args.password ?? generatePassword();
  if (password.length < 10) throw new Error('Password must be at least 10 characters');

  const passwordHash = await bcrypt.hash(password, env.auth.bcryptRounds);
  const existing = await queryOne<{ id: string }>('SELECT id FROM cms_users WHERE lower(email) = lower($1)', [
    args.email,
  ]);

  if (existing) {
    await query(
      `UPDATE cms_users
          SET password_hash = $2,
              role          = $3,
              status        = 'active',
              full_name     = COALESCE($4, full_name)
        WHERE id = $1`,
      [existing.id, passwordHash, role, args.name ?? null],
    );
    // The old password may be what needs revoking, so every session it opened
    // has to go with it.
    await query('UPDATE cms_sessions SET revoked_at = now() WHERE cms_user_id = $1 AND revoked_at IS NULL', [
      existing.id,
    ]);
    process.stdout.write(`\n  Updated the existing CMS account for ${args.email}.\n`);
  } else {
    await query('INSERT INTO cms_users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4)', [
      args.name ?? args.email.split('@')[0],
      args.email,
      passwordHash,
      role,
    ]);
    process.stdout.write(`\n  Created a CMS account for ${args.email}.\n`);
  }

  process.stdout.write(`  Role:     ${role}\n`);
  process.stdout.write(`  Password: ${password}\n`);
  if (!args.password) {
    process.stdout.write('\n  This is the only time the generated password is shown. Save it now.\n');
  }
  process.stdout.write(`\n  Sign in at ${env.webBaseUrl}/cms/login\n\n`);
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err: err instanceof Error ? err.message : err }, 'Could not create the CMS account');
    await closePool().catch(() => undefined);
    process.exit(1);
  });
