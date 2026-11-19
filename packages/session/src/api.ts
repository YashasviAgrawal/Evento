/**
 * Typed API client shared by every Tixit web app.
 *
 * Works in server and client components. In the browser it attaches the
 * in-memory access token and, on an expired token, refreshes once and retries,
 * so a 15-minute token never surfaces as "please sign in" mid-checkout.
 */
import { API_URL, CLIENT_HEADER, clearSession, getAccessToken, refreshSession } from './session';
import type { PageMeta } from './types';

export { API_URL };

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

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Attach the access token. Defaults to true in the browser. */
  auth?: boolean;
  /** Next.js fetch caching, used by server components. */
  revalidate?: number;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_URL}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * 401s that mean "this sign-in attempt failed", not "your session died" — a
 * signed-in user who mistypes a password must not be logged out.
 */
const SIGN_IN_FAILURE_CODES = new Set([
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_REGISTERED',
  'USE_GOOGLE_SIGN_IN',
  'GOOGLE_TOKEN_INVALID',
  'GOOGLE_EMAIL_UNVERIFIED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_NOT_FOUND',
  'PHONE_NOT_REGISTERED',
]);

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<{ data: T; meta?: PageMeta }> {
  const { body, auth, revalidate, query, headers, ...rest } = options;
  const isBrowser = typeof window !== 'undefined';
  const useAuth = (auth ?? isBrowser) && isBrowser;

  const finalHeaders: Record<string, string> = {
    accept: 'application/json',
    ...(isBrowser ? CLIENT_HEADER : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(useAuth ? authHeaders() : {}),
    ...((headers as Record<string, string>) ?? {}),
  };

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

    if (response.status === 401 && useAuth && !isRetry && error.code === 'TOKEN_EXPIRED' && (await refreshSession())) {
      return request<T>(path, options, true);
    }
    if (response.status === 401 && useAuth && !SIGN_IN_FAILURE_CODES.has(error.code)) {
      clearSession({ announce: false });
    }
    throw new ApiError(response.status, error.code, error.message, error.details);
  }

  return { data: payload.data as T, meta: payload.meta };
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
};

/**
 * Server-component fetch: never sends credentials, tolerates the API being
 * unreachable during a build by returning null instead of throwing.
 */
export async function fetchPublic<T>(path: string, query?: RequestOptions['query'], revalidate = 30): Promise<T | null> {
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

/** Authenticated fetch of a raw response (files, multipart), with one refresh-and-retry. */
export async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = () =>
    fetch(buildUrl(path), {
      ...init,
      headers: { ...CLIENT_HEADER, ...authHeaders(), ...((init.headers as Record<string, string>) ?? {}) },
      credentials: 'include',
    });
  let response = await send();
  if (response.status === 401 && (await refreshSession())) response = await send();
  return response;
}

/** Fetch a private file (e.g. a KYC document) an <img> cannot fetch with a token itself. */
export async function fetchPrivateFile(path: string): Promise<Blob> {
  const response = await authorizedFetch(path, { cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status, 'FILE_UNAVAILABLE', 'Could not load the file');
  return response.blob();
}

/** Multipart upload; FormData must not carry a JSON content-type. */
export async function uploadForm<T>(path: string, body: FormData): Promise<T> {
  const response = await authorizedFetch(path, { method: 'POST', body });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const error = payload?.error ?? { code: 'UPLOAD_FAILED', message: 'Upload failed' };
    throw new ApiError(response.status, error.code, error.message, error.details);
  }
  return payload.data as T;
}

/** Authenticated file download (CSV / PDF). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await authorizedFetch(path);
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
