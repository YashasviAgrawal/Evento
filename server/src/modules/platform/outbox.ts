/**
 * Transactional outbox.
 *
 * `enqueue` writes an event in the caller's transaction, so it exists if and
 * only if the business change committed. `dispatchOutbox` delivers events to
 * registered handlers afterwards: rows are claimed with FOR UPDATE SKIP LOCKED
 * (any number of API instances can dispatch without double-delivery), failed
 * handlers are retried with exponential backoff, and an event that keeps
 * failing is parked as dead rather than retried forever.
 *
 * Handlers must be idempotent — delivery is at-least-once.
 */
import { logger } from '../../config/logger';
import { pool, query, type Queryable } from '../../db/pool';

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, Handler[]>();
const MAX_ATTEMPTS = 8;

export function onOutbox(topic: string, handler: Handler): void {
  handlers.set(topic, [...(handlers.get(topic) ?? []), handler]);
}

export async function enqueue(client: Queryable, topic: string, payload: Record<string, unknown>): Promise<void> {
  await client.query('INSERT INTO outbox_events (topic, payload) VALUES ($1, $2::jsonb)', [topic, JSON.stringify(payload)]);
}

interface OutboxRow {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Deliver up to `limit` due events. Returns how many were processed. */
export async function dispatchOutbox(limit = 50): Promise<number> {
  const client = await pool.connect();
  let processed = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, topic, payload, attempts FROM outbox_events
        WHERE processed_at IS NULL AND dead_at IS NULL AND available_at <= now()
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const row of rows) {
      try {
        for (const handler of handlers.get(row.topic) ?? []) await handler(row.payload);
        await client.query('UPDATE outbox_events SET processed_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
        processed += 1;
      } catch (err) {
        const attempts = row.attempts + 1;
        const dead = attempts >= MAX_ATTEMPTS;
        logger.error({ err, topic: row.topic, id: row.id, attempts, dead }, 'Outbox handler failed');
        await client.query(
          `UPDATE outbox_events SET attempts = $2, last_error = $3,
                  available_at = now() + make_interval(secs => least(3600, power(2, $2)::int * 5)),
                  dead_at = CASE WHEN $4 THEN now() END
            WHERE id = $1`,
          [row.id, attempts, err instanceof Error ? err.message : String(err), dead],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return processed;
}

let draining: Promise<void> | null = null;

/**
 * Nudge the dispatcher right after a commit so effects feel instant; the
 * scheduler's periodic pass is the safety net. Never throws.
 */
export function kickOutbox(): void {
  if (draining) return;
  draining = (async () => {
    try {
      while ((await dispatchOutbox()) > 0) {
        // keep going while there is work
      }
    } catch (err) {
      logger.error({ err }, 'Outbox dispatch failed');
    } finally {
      draining = null;
    }
  })();
}

/** Wait for every due event to be handled (tests, scripts). */
export async function drainOutbox(): Promise<void> {
  if (draining) await draining;
  while ((await dispatchOutbox()) > 0) {
    // drain
  }
}

export async function outboxBacklog(): Promise<{ pending: number; dead: number }> {
  const { rows } = await query<{ pending: number; dead: number }>(
    `SELECT count(*) FILTER (WHERE processed_at IS NULL AND dead_at IS NULL)::int AS pending,
            count(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead
       FROM outbox_events`,
  );
  return rows[0] ?? { pending: 0, dead: 0 };
}
