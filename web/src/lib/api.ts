/**
 * Typed API client.
 *
 * One module for both server and client components. On the client the access
 * token is read from localStorage and a 401 triggers a single silent refresh
 * before the request is retried, so a 15-minute access token never surfaces as
 * a spurious "please sign in" to someone mid-checkout.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const ACCESS_TOKEN_KEY = 'evento.accessToken';
const REFRESH_TOKEN_KEY = 'evento.refreshToken';
const USER_KEY = 'evento.user';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Flatten Zod-style field errors into "field: message" lines. */
  get fieldMessages(): string[] {
    if (!Array.isArray(this.details)) return [];
    return (this.details as Array<{ field?: string; message?: string }>)
      .filter((detail) => detail?.message)
      .map((detail) => (detail.field && detail.field !== '(root)' ? `${detail.field}: ${detail.message}` : detail.message!));
  }
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

/* ───────────────────── token storage (client only) ───────────────────── */

export const tokenStore = {
  get access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  get refresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  set(access: string, refresh?: string): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACCESS_TOKEN_KEY, access);
    if (refresh) window.localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
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
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  },
};

/* ─────────────────────────── core fetch ─────────────────────────── */

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Attach the stored access token. Defaults to true in the browser. */
  auth?: boolean;
  /** Next.js fetch caching, used by server components. */
  revalidate?: number;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_URL}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * 401s that mean "this sign-in attempt failed", not "your session died".
 *
 * Any other 401 clears the stored tokens, which is right for an expired
 * session but wrong here: a signed-in user who mistypes a password on the
 * login page, or whose Google token was rejected, must not be logged out of
 * the session they already had.
 */
const SIGN_IN_FAILURE_CODES = new Set([
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_REGISTERED',
  'USE_GOOGLE_SIGN_IN',
  'GOOGLE_TOKEN_INVALID',
  'GOOGLE_EMAIL_UNVERIFIED',
]);

let refreshInFlight: Promise<boolean> | null = null;

/** Exchange the refresh token for a new access token. De-duplicated. */
async function refreshAccessToken(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = tokenStore.refresh;
    if (!refreshToken) return false;
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        credentials: 'include',
      });
      if (!response.ok) return false;
      const payload = await response.json();
      tokenStore.set(payload.data.accessToken, payload.data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<{ data: T; meta?: PageMeta }> {
  const { body, auth, revalidate, query, headers, ...rest } = options;
  const isBrowser = typeof window !== 'undefined';
  const useAuth = auth ?? isBrowser;

  const finalHeaders: Record<string, string> = {
    accept: 'application/json',
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...((headers as Record<string, string>) ?? {}),
  };

  if (useAuth && isBrowser) {
    const token = tokenStore.access;
    if (token) finalHeaders.authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl(path, query), {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: isBrowser ? 'include' : 'omit',
    ...(revalidate !== undefined ? { next: { revalidate } } : { cache: rest.cache ?? 'no-store' }),
  });

  if (response.status === 204) return { data: undefined as T };

  let payload: { success?: boolean; data?: T; meta?: PageMeta; error?: { code: string; message: string; details?: unknown } };
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, 'BAD_RESPONSE', `Unexpected response from the server (${response.status})`);
  }

  if (!response.ok || payload.success === false) {
    const error = payload.error ?? { code: 'UNKNOWN', message: 'Something went wrong' };

    // One transparent refresh-and-retry on an expired access token.
    if (response.status === 401 && !isRetry && error.code === 'TOKEN_EXPIRED' && (await refreshAccessToken())) {
      return request<T>(path, options, true);
    }
    if (response.status === 401 && isBrowser && !SIGN_IN_FAILURE_CODES.has(error.code)) {
      tokenStore.clear();
    }

    throw new ApiError(response.status, error.code, error.message, error.details);
  }

  return { data: payload.data as T, meta: payload.meta };
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
};

/**
 * Server-component fetch: never sends credentials, tolerates the API being
 * unreachable during a build by returning null instead of throwing.
 */
export async function fetchPublic<T>(
  path: string,
  query?: RequestOptions['query'],
  revalidate = 30,
): Promise<T | null> {
  try {
    const { data } = await request<T>(path, { auth: false, revalidate, query });
    return data;
  } catch {
    return null;
  }
}

export async function fetchPublicPaged<T>(
  path: string,
  query?: RequestOptions['query'],
  revalidate = 30,
): Promise<{ data: T; meta?: PageMeta } | null> {
  try {
    return await request<T>(path, { auth: false, revalidate, query });
  } catch {
    return null;
  }
}

/** Authenticated file download (CSV / PDF) that respects the bearer token. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = tokenStore.access;
  const response = await fetch(buildUrl(path), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Could not download the file');

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
