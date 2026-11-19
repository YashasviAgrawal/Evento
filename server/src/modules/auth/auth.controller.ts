import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { asyncHandler, clientIp, ok } from '../../utils/http';
import { UnauthorizedError } from '../../utils/errors';
import { currentUser } from '../../middleware/auth';
import * as authService from './auth.service';
import { revokeRefreshToken, rotateRefreshToken, signAccessToken } from './token.service';

/**
 * Session cookies — the mechanism behind single sign-on across Tixit apps.
 *
 * `tx_rt` carries the refresh credential. It is HttpOnly and host-only on the
 * API host, so no frontend script can read it, yet both www.tixit.in and
 * dinein.tixit.in send it: they are same-site with api.tixit.in. Whichever app
 * a person signs in on, the other picks the session up with one /refresh call.
 *
 * `tx_session` is a non-secret hint scoped to the whole domain. It lets each
 * app's server render the signed-in shell without a flash, and lets a tab
 * notice that the user signed out in the *other* app. It grants nothing.
 *
 * SameSite=Lax rather than Strict so following a link from an email or a
 * WhatsApp message keeps the session.
 */
const REFRESH_COOKIE = 'tx_rt';
const LEGACY_REFRESH_COOKIE = 'refresh_token';
const SESSION_HINT_COOKIE = 'tx_session';
const REFRESH_PATH = '/api/v1/auth';

/** Native apps cannot use cookies; they opt in to receiving tokens in the body. */
function isNativeClient(req: Request): boolean {
  return String(req.headers['x-tixit-client'] ?? '').toLowerCase() === 'mobile';
}

function setSessionCookies(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    expires: expiresAt,
    path: REFRESH_PATH,
  });
  res.cookie(SESSION_HINT_COOKIE, '1', {
    httpOnly: false,
    secure: env.isProd,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
    domain: env.auth.cookieDomain,
  });
  // Retire the pre-SSO cookie the first time a browser rotates onto tx_rt.
  res.clearCookie(LEGACY_REFRESH_COOKIE, { path: REFRESH_PATH });
}

function clearSessionCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  res.clearCookie(LEGACY_REFRESH_COOKIE, { path: REFRESH_PATH });
  res.clearCookie(SESSION_HINT_COOKIE, { path: '/', domain: env.auth.cookieDomain });
}

/**
 * Pick the refresh credential for this request.
 *
 * A body token is accepted from native clients, and once from browsers that
 * still hold a pre-SSO token in localStorage (the web client hands it over and
 * deletes it). A cookie-borne token must arrive with the `X-Tixit-Client`
 * header: a cross-site form cannot set custom headers, and a cross-site fetch
 * that does is stopped by the CORS preflight — together a CSRF guard.
 */
function refreshCredential(req: Request): string | undefined {
  const fromBody = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
  if (fromBody) return fromBody;

  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
  const fromCookie = cookies[REFRESH_COOKIE] ?? cookies[LEGACY_REFRESH_COOKIE];
  if (!fromCookie) return undefined;
  if (!req.headers['x-tixit-client']) {
    throw new UnauthorizedError('Missing client header', 'CSRF_HEADER_MISSING');
  }
  return fromCookie;
}

function requestContext(req: Request) {
  return { userAgent: req.headers['user-agent'], ip: clientIp(req) };
}

/** Session payload shared by every sign-in route. */
function sessionBody(
  req: Request,
  user: unknown,
  tokens: { accessToken: string; refreshToken: string },
  extra: Record<string, unknown> = {},
) {
  return {
    user,
    accessToken: tokens.accessToken,
    ...(isNativeClient(req) ? { refreshToken: tokens.refreshToken } : {}),
    ...extra,
  };
}

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, { ip: clientIp(req) });
  return ok(res, result, 201);
});

export const login = asyncHandler(async (req, res) => {
  const row = await authService.login(req.body);
  const tokens = await authService.createSession(row, requestContext(req));
  setSessionCookies(res, tokens.refreshToken, tokens.expiresAt);
  return ok(res, sessionBody(req, authService.toPublicUser(row), tokens));
});

/**
 * One endpoint for both signing in and signing up with Google — the caller
 * cannot know which it is, and does not need to. 201 when an account was
 * created, 200 when an existing one signed in.
 */
export const googleAuth = asyncHandler(async (req, res) => {
  const { user, created } = await authService.loginWithGoogle(req.body.credential, { ip: clientIp(req) });
  const tokens = await authService.createSession(user, requestContext(req));
  setSessionCookies(res, tokens.refreshToken, tokens.expiresAt);
  return ok(res, sessionBody(req, authService.toPublicUser(user), tokens, { created }), created ? 201 : 200);
});

export const requestOtp = asyncHandler(async (req, res) => {
  const result = await authService.requestOtp(req.body.email, req.body.purpose);
  return ok(res, { ...result, message: 'A code is on its way to your inbox.' });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const row = await authService.verifyOtpAndResolve(req.body, { ip: clientIp(req) });
  const tokens = await authService.createSession(row, requestContext(req));
  setSessionCookies(res, tokens.refreshToken, tokens.expiresAt);
  return ok(res, sessionBody(req, authService.toPublicUser(row), tokens));
});

/**
 * Exchange the refresh credential for an access token and the current user.
 *
 * This is the call every Tixit app makes on boot: returning the user here means
 * single sign-on costs one round trip, not two.
 */
export const refresh = asyncHandler(async (req, res) => {
  const token = refreshCredential(req);
  if (!token) throw new UnauthorizedError('No refresh token supplied', 'NO_REFRESH_TOKEN');

  let rotated;
  try {
    rotated = await rotateRefreshToken(token, requestContext(req));
  } catch (err) {
    // A dead credential must not linger and be retried on every page load.
    clearSessionCookies(res);
    throw err;
  }

  const row = await authService.getUserRowForSession(rotated.userId);
  if (!row) {
    clearSessionCookies(res);
    throw new UnauthorizedError('Account is no longer active', 'ACCOUNT_INACTIVE');
  }

  const accessToken = signAccessToken({ sub: row.id, role: row.role, email: row.email });
  setSessionCookies(res, rotated.token, rotated.expiresAt);
  return ok(res, sessionBody(req, authService.toPublicUser(row), { accessToken, refreshToken: rotated.token }));
});

export const logout = asyncHandler(async (req, res) => {
  let token: string | undefined;
  try {
    token = refreshCredential(req);
  } catch {
    token = undefined;
  }
  if (token) await revokeRefreshToken(token);
  clearSessionCookies(res);
  return ok(res, { message: 'Signed out' });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(currentUser(req).id);
  return ok(res, user);
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(currentUser(req).id, req.body);
  return ok(res, user);
});

export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(currentUser(req).id, req.body);
  clearSessionCookies(res);
  return ok(res, { message: 'Password updated. Please sign in again.' });
});

/* ───────────────────────── phone sign-in ───────────────────────── */

export const requestPhoneOtp = asyncHandler(async (req, res) => {
  const result = await authService.requestPhoneOtp(req.body.phone);
  return ok(res, { ...result, message: 'A code is on its way by SMS.' });
});

export const verifyPhoneOtp = asyncHandler(async (req, res) => {
  const row = await authService.verifyPhoneOtp(req.body.phone, req.body.code);
  const tokens = await authService.createSession(row, requestContext(req));
  setSessionCookies(res, tokens.refreshToken, tokens.expiresAt);
  return ok(res, sessionBody(req, authService.toPublicUser(row), tokens));
});
