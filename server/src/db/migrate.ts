/**
 * Minimal forward-only migration runner.
 *
 * Each .sql file in ./migrations is applied once, in filename order, inside a
 * single transaction. A checksum is recorded so that editing an already-applied
 * migration is detected instead of silently diverging environments.
 *
 *   npm run migrate           apply pending migrations
 *   npm run migrate:status    show applied / pending
 *   tsx src/db/migrate.ts reset   drop and recreate the public schema (dev only)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { pool, closePool } from './pool';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

function loadMigrations(): MigrationFile[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      return { name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16) };
    });
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER NOT NULL DEFAULT 0
    )
  `);
}

async function appliedMigrations(): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  return new Map(rows.map((row) => [row.name, row.checksum]));
}

export async function up(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();
  const files = loadMigrations();
  let ran = 0;

  for (const file of files) {
    const previous = applied.get(file.name);
    if (previous) {
      if (previous !== file.checksum) {
        logger.warn(
          { migration: file.name },
          'Migration file changed after being applied — create a new migration instead of editing history',
        );
      }
      continue;
    }

    const startedAt = Date.now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(file.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)', [
        file.name,
        file.checksum,
        Date.now() - startedAt,
      ]);
      await client.query('COMMIT');
      ran += 1;
      logger.info({ migration: file.name, ms: Date.now() - startedAt }, 'Applied migration');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      logger.error({ err, migration: file.name }, 'Migration failed — rolled back');
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info(ran === 0 ? 'Database already up to date' : `Applied ${ran} migration(s)`);
}

export async function status(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();
  for (const file of loadMigrations()) {
    const state = applied.has(file.name) ? 'applied' : 'pending';
    process.stdout.write(`  [${state === 'applied' ? '✓' : ' '}] ${file.name}  (${state})\n`);
  }
}

export async function reset(): Promise<void> {
  if (env.isProd) throw new Error('Refusing to reset the database in production');
  logger.warn('Dropping and recreating the public schema');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await up();
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  switch (command) {
    case 'up':
      await up();
      break;
    case 'status':
      await status();
      break;
    case 'reset':
      await reset();
      break;
    default:
      throw new Error(`Unknown command "${command}". Use one of: up, status, reset`);
  }
}

if (require.main === module) {
  main()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (err) => {
      logger.error({ err }, 'Migration command failed');
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
