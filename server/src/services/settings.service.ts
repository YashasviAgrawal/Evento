import { env } from '../config/env';
import { dbRunner, query, type Queryable } from '../db/pool';

/**
 * Platform settings live in the `settings` table so admins can change pricing
 * rules without a deploy. Values are cached in-process for a short TTL because
 * they are read on every booking; the cache is invalidated on write.
 */

export interface PlatformSettings {
  commission_percent: number;
  tax_percent: number;
  convenience_fee_percent: number;
  booking_hold_minutes: number;
  refund_window_hours: number;
  support_email: string;
  platform_name: string;
  auto_approve_events: boolean;
}

const DEFAULTS: PlatformSettings = {
  commission_percent: env.business.defaultCommissionPercent,
  tax_percent: env.business.defaultTaxPercent,
  convenience_fee_percent: env.business.defaultConvenienceFeePercent,
  booking_hold_minutes: env.business.bookingHoldMinutes,
  refund_window_hours: 48,
  support_email: 'support@tixit.in',
  platform_name: 'Tixit',
  auto_approve_events: false,
};

const CACHE_TTL_MS = 30_000;
let cache: { value: PlatformSettings; expiresAt: number } | null = null;

export async function getSettings(client?: Queryable): Promise<PlatformSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const runner = dbRunner(client);
  const { rows } = await runner.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');

  const merged = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in merged) {
      (merged as Record<string, unknown>)[row.key] = row.value;
    }
  }

  cache = { value: merged, expiresAt: Date.now() + CACHE_TTL_MS };
  return merged;
}

export async function getSetting<K extends keyof PlatformSettings>(key: K): Promise<PlatformSettings[K]> {
  return (await getSettings())[key];
}

export async function updateSettings(
  patch: Partial<PlatformSettings>,
  updatedBy: string | null,
): Promise<PlatformSettings> {
  const entries = Object.entries(patch).filter(([key]) => key in DEFAULTS);
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), updatedBy],
    );
  }
  invalidateSettingsCache();
  return getSettings();
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/**
 * Resolve the commission rate that applies to a specific organizer.
 * A per-organizer override always beats the platform default.
 */
export async function resolveCommissionPercent(
  organizerOverride: number | null | undefined,
  client?: Queryable,
): Promise<number> {
  if (organizerOverride !== null && organizerOverride !== undefined) return Number(organizerOverride);
  const settings = await getSettings(client);
  return Number(settings.commission_percent);
}
