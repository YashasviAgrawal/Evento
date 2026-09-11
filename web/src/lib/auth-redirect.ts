import type { Role } from '@/lib/types';

/**
 * Areas that belong to exactly one role. `RequireAuth` captures the path you
 * were on when the session ended, so signing out of a dashboard leaves
 * `?next=/organizer` (or `/admin`) on the login page. Honouring that blindly
 * sends the *next* person who signs in there back to the dashboard they never
 * asked for — an admin landing in the organizer console, a customer landing on
 * an access-denied screen. Ownership is stricter than access on purpose: an
 * admin may open the organizer console, but signing in should still take them
 * to their own.
 */
const ROLE_AREAS: ReadonlyArray<{ prefix: string; role: Role }> = [
  { prefix: '/admin', role: 'admin' },
  { prefix: '/organizer', role: 'organizer' },
];

/**
 * Sits inside the organizer area but is the page a customer uses to apply, so
 * it stays reachable by every role — the same exception the organizer layout
 * makes for its role guard.
 */
const ROLE_AREA_EXCEPTIONS = ['/organizer/register'];

function isWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The `next` destination to use after signing in, or `null` when the caller
 * should fall back to its own default for the role.
 *
 * Anything outside a role-owned area is kept as-is, which is what preserves the
 * customer flow: someone sent to sign in from an event page or a checkout cart
 * still returns to exactly where they left off.
 */
export function safeNext(next: string, role: Role | undefined): string | null {
  if (!next) return null;
  // Same-origin paths only — `//evil.com` and absolute URLs are not ours.
  if (!next.startsWith('/') || next.startsWith('//')) return null;

  const path = next.split(/[?#]/)[0] ?? '';
  if (ROLE_AREA_EXCEPTIONS.some((prefix) => isWithin(path, prefix))) return next;

  const area = ROLE_AREAS.find((candidate) => isWithin(path, candidate.prefix));
  if (area && area.role !== role) return null;

  return next;
}
