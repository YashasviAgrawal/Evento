/**
 * The browser side of Tixit single sign-on.
 *
 * The refresh credential is an HttpOnly cookie on the API host (`tx_rt`),
 * which this code can neither read nor needs to. Every Tixit app — www,
 * dine-in — exchanges it for a short-lived access token on boot, and keeps
 * that token **in memory only**: nothing an XSS payload could lift from
 * storage, and nothing per-origin that would stop two subdomains sharing a
 * session.
 *
 * `tx_session` is a readable, non-secret hint cookie set for the whole domain.
 * It answers "is anyone signed in?" without a request, which lets an app skip
 * the refresh call for anonymous visitors and notice, when a tab regains
 * focus, that the person signed in or out in another Tixit app.
 */
import type { SessionResponse, SessionUser } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Sent with every request; cookie-authenticated endpoints require it (CSRF guard). */
export const CLIENT_HEADER = { 'x-tixit-client': 'browser' } as const;

const HINT_COOKIE = 'tx_session';
const CHANNEL = 'tixit-auth';
/** Pre-SSO builds kept tokens here; they are exchanged once, then deleted. */
const LEGACY_KEYS = { access: 'evento.accessToken', refresh: 'evento.refreshToken', user: 'evento.user' };

let accessToken: string | null = null;
let currentUser: SessionUser | null = null;
const listeners = new Set<(user: SessionUser | null) => void>();

const isBrowser = () => typeof window !== 'undefined';

function emit(): void {
  for (const listener of listeners) listener(currentUser);
}

export function subscribe(listener: (user: SessionUser | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getSessionUser(): SessionUser | null {
  return currentUser;
}

export function hasSessionHint(): boolean {
  if (!isBrowser()) return false;
  return document.cookie.split(';').some((part) => part.trim().startsWith(`${HINT_COOKIE}=`));
}

function legacyRefreshToken(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(LEGACY_KEYS.refresh);
  } catch {
    return null;
  }
}

function dropLegacyTokens(): void {
  if (!isBrowser()) return;
  try {
    Object.values(LEGACY_KEYS).forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable (private mode); nothing to clean up then.
  }
}

/* ─────────────────────── cross-tab sync (same origin) ─────────────────────── */

let channel: BroadcastChannel | null = null;
function broadcast(message: 'signed-in' | 'signed-out'): void {
  if (!isBrowser() || typeof BroadcastChannel === 'undefined') return;
  channel ??= new BroadcastChannel(CHANNEL);
  channel.postMessage(message);
}

export function onCrossTabMessage(handler: (message: 'signed-in' | 'signed-out') => void): () => void {
  if (!isBrowser() || typeof BroadcastChannel === 'undefined') return () => undefined;
  const listener = new BroadcastChannel(CHANNEL);
  listener.onmessage = (event) => handler(event.data);
  return () => listener.close();
}

/* ─────────────────────────── state changes ─────────────────────────── */

/** Record a session a sign-in route just returned. */
export function setSession(session: SessionResponse, options: { announce?: boolean } = {}): SessionUser {
  accessToken = session.accessToken;
  currentUser = session.user;
  dropLegacyTokens();
  emit();
  if (options.announce !== false) broadcast('signed-in');
  return session.user;
}

export function updateSessionUser(user: SessionUser): void {
  currentUser = user;
  emit();
}

/** Forget the session locally (the server side is handled by /auth/logout). */
export function clearSession(options: { announce?: boolean } = {}): void {
  const hadSession = Boolean(accessToken || currentUser);
  accessToken = null;
  currentUser = null;
  dropLegacyTokens();
  emit();
  if (hadSession && options.announce !== false) broadcast('signed-out');
}

/* ─────────────────────────── refresh ─────────────────────────── */

let inFlight: Promise<SessionUser | null> | null = null;

/**
 * Exchange the refresh cookie for an access token and the user. De-duplicated
 * so a burst of 401s, or a boot racing a focus event, makes one call. The
 * server tolerates two *apps* racing each other (reuse grace window).
 */
export function refreshSession(): Promise<SessionUser | null> {
  if (!isBrowser()) return Promise.resolve(null);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const legacy = legacyRefreshToken();
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...CLIENT_HEADER },
        // A pre-SSO browser hands its stored token over once; the response
        // moves it into the HttpOnly cookie and the copy here is deleted.
        body: JSON.stringify(legacy ? { refreshToken: legacy } : {}),
      });
      if (!response.ok) {
        clearSession({ announce: false });
        return null;
      }
      const payload = (await response.json()) as { data: SessionResponse };
      return setSession(payload.data, { announce: false });
    } catch {
      // Offline or API unreachable: keep whatever we had rather than signing out.
      return currentUser;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Resolve the session for a fresh page: reuse the in-memory one, else pick up
 * a session started in any Tixit app. Anonymous visitors cost no request.
 */
export async function bootSession(): Promise<SessionUser | null> {
  if (accessToken && currentUser) return currentUser;
  if (!hasSessionHint() && !legacyRefreshToken()) return null;
  return refreshSession();
}

/** Revoke the session server-side for every Tixit app, then forget it here. */
export async function endSession(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...CLIENT_HEADER },
      body: '{}',
    });
  } catch {
    // Signing out locally must succeed even if the API call does not.
  }
  clearSession();
}
