import { logger } from '../config/logger';
import { dbRunner, type Queryable } from '../db/pool';
import type { Role } from '../middleware/auth';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: Role | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Append an entry to the audit trail.
 *
 * Auditing is observability, not business logic: a failure here is logged but
 * never surfaced to the caller or allowed to roll back the action it records.
 */
export async function audit(entry: AuditEntry, client?: Queryable): Promise<void> {
  const runner = dbRunner(client);
  try {
    await runner.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata, ip)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        entry.actorId ?? null,
        entry.actorRole ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.ip ?? null,
      ],
    );
  } catch (err) {
    logger.warn({ err, action: entry.action }, 'Failed to write audit log');
  }
}
