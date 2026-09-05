import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * node-postgres returns BIGINT (oid 20) and NUMERIC (oid 1700) as strings to
 * avoid precision loss. All monetary values in this schema are stored as
 * integer paise inside BIGINT columns and comfortably fit in a JS number
 * (Number.MAX_SAFE_INTEGER is ~90 trillion rupees), so parsing them is safe
 * and saves a string→number conversion at every call site.
 */
types.setTypeParser(types.builtins.INT8, (value) => Number.parseInt(value, 10));
types.setTypeParser(types.builtins.NUMERIC, (value) => Number.parseFloat(value));

export const pool = new Pool({
  connectionString: env.db.url,
  max: env.db.poolMax,
  ssl: env.db.ssl ? { rejectUnauthorized: false } : undefined,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'tixit-api',
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

/**
 * The subset of the pg client surface this codebase uses. Both `PoolClient`
 * (inside a transaction) and the module-level `query` helper satisfy it, so
 * services can accept an optional client and work either way.
 */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    // `any[]` rather than `readonly unknown[]` so PoolClient stays assignable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** Use the caller's transaction client when given one, else the pool. */
export function dbRunner(client?: Queryable | null): Queryable {
  return client ?? { query };
}

/** Run a single query on a pooled connection. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const startedAt = process.hrtime.bigint();
  try {
    const result = await pool.query<T>(text, params as unknown[]);
    return { rows: result.rows, rowCount: result.rowCount };
  } finally {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (ms > 250) {
      logger.warn({ ms: Math.round(ms), sql: text.replace(/\s+/g, ' ').slice(0, 160) }, 'Slow query');
    }
  }
}

/** Convenience: first row or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const { rows } = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a transaction, rolling back on any thrown error.
 *
 * Retries on PostgreSQL serialization/deadlock errors (40001, 40P01), which
 * concurrent ticket purchases against the same event can legitimately hit.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: { retries?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 2;

  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (err as { code?: string }).code;
      const retryable = code === '40001' || code === '40P01';
      if (retryable && attempt < retries) {
        logger.warn({ code, attempt }, 'Retrying transaction after serialization failure');
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function healthcheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    logger.error({ err }, 'Database healthcheck failed');
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
