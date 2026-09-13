/**
 * API client for the CMS.
 *
 * A deliberate twin of `lib/api.ts` rather than a mode of it. The CMS has its
 * own accounts, so it needs its own tokens, its own storage keys and its own
 * refresh endpoint — sharing any of those would mean signing out of the site
 * also signs you out of the CMS, and a stale storefront token could be sent to
 * a CMS route. Keeping them apart costs one small module and removes a whole
 * class of "which session am I in?" bugs.
 */

import { ApiError, API_URL, type PageMeta } from './api';

export { ApiError };
export type { PageMeta };

const ACCESS_TOKEN_KEY = 'tixit.cms.accessToken';
const SESSION_TOKEN_KEY = 'tixit.cms.sessionToken';
const USER_KEY = 'tixit.cms.user';

export const cmsTokenStore = {
  get access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  get session(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  },
  set(access: string, session?: string): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACCESS_TOKEN_KEY, access);
    if (session) window.localStorage.setItem(SESSION_TOKEN_KEY, session);
  },
  setUser(user: unknown): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  getUser<T>(): T | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  },
};

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_URL}/cms${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * A failed sign-in must not clear a session that is already working — someone
 * mistyping a password on the login screen should stay signed in on the tab
 * they already had open.
 */
const SIGN_IN_FAILURE_CODES = new Set(['INVALID_CREDENTIALS', 'RATE_LIMITED']);

let refreshInFlight: Promise<boolean> | null = null;

/** Exchange the rotating session token for a fresh access token. De-duplicated. */
async function refreshAccessToken(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const sessionToken = cmsTokenStore.session;
    if (!sessionToken) return false;
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionToken }),
      });
      if (!response.ok) return false;
      const payload = await response.json();
      cmsTokenStore.set(payload.data.accessToken, payload.data.sessionToken);
      cmsTokenStore.setUser(payload.data.user);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<{ data: T; meta?: PageMeta }> {
  const { body, query, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    accept: 'application/json',
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...((headers as Record<string, string>) ?? {}),
  };

  // A header of its own, not `authorization`: the two sessions must never be
  // able to stand in for one another by accident.
  const token = cmsTokenStore.access;
  if (token) finalHeaders['x-cms-authorization'] = `Bearer ${token}`;

  const response = await fetch(buildUrl(path, query), {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  if (response.status === 204) return { data: undefined as T };

  let payload: {
    success?: boolean;
    data?: T;
    meta?: PageMeta;
    error?: { code: string; message: string; details?: unknown };
  };
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, 'BAD_RESPONSE', `Unexpected response from the server (${response.status})`);
  }

  if (!response.ok || payload.success === false) {
    const error = payload.error ?? { code: 'UNKNOWN', message: 'Something went wrong' };

    if (response.status === 401 && !isRetry && error.code === 'TOKEN_EXPIRED' && (await refreshAccessToken())) {
      return request<T>(path, options, true);
    }
    if (response.status === 401 && !SIGN_IN_FAILURE_CODES.has(error.code)) {
      cmsTokenStore.clear();
    }

    throw new ApiError(response.status, error.code, error.message, error.details);
  }

  return { data: payload.data as T, meta: payload.meta };
}

export const cmsApi = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
};
