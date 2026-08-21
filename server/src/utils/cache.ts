/**
 * Small in-process TTL cache for read-heavy public endpoints (home feed,
 * event listings, catalog reference data). These are hit on nearly every
 * page load but only change when an organizer or admin mutates data, so a
 * short TTL turns repeated remote Postgres round trips into memory reads
 * without risking noticeably stale data. Same pattern as the settings cache
 * in `services/settings.service.ts`, generalized so other modules can share it.
 *
 * Process-local: on a multi-instance deployment each instance has its own
 * cache, which is fine at this TTL/traffic scale but won't give a single
 * shared cache across replicas.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = 500;
const store = new Map<string, CacheEntry<unknown>>();

/** Return the cached value for `key`, or compute, store, and return it via `fn`. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = await fn();

  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/** Drop cached entries. With no prefix, clears everything; otherwise only keys starting with it. */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
