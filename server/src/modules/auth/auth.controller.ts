import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { asyncHandler, clientIp, ok } from '../../utils/http';
import { UnauthorizedError } from '../../utils/errors';
import { currentUser } from '../../middleware/auth';
import * as authService from './auth.service';
import { revokeRefreshToken, rotateRefreshToken, signAccessToken } from './token.service';
import { queryOne } from '../../db/pool';

const REFRESH_COOKIE = 'refresh_token';

/**
 * The refresh token is delivered as an httpOnly cookie so browser clients are
 * not exposed to XSS token theft. It is also returned in the JSON body for
 * non-browser clients (the future mobile app) that cannot use cookies.
 */
function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? 'strict' : 'lax',
    expires: expiresAt,
    path: '/api/v1/auth',
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}

function requestContext(req: Request) {
  return { userAgent: req.headers['user-agent'], ip: clientIp(req) };
}

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, { ip: clientIp(req) });
  return ok(res, result, 201);
});

export const login = asyncHandler(async (req, res) => {
  const row = await authService.login(req.body);
  const tokens = await authService.createSession(row, requestContext(req));
  setRefreshCookie(res, tokens.refreshToken, tokens.expiresAt);
  return ok(res, {
    user: authService.toPublicUser(row),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

/**
 * One endpoint for both signing in and signing up with Google — the caller
 * cannot know which it is, and does not need to. 201 when an account was
 * created, 200 when an existing one signed in.
 */
export const googleAuth = asyncHandler(async (req, res) => {
  const { user, created } = await authService.loginWithGoogle(req.body.credential, { ip: clientIp(req) });
  const tokens = await authService.createSession(user, requestContext(req));
  setRefreshCookie(res, tokens.refreshToken, tokens.expiresAt);
  return ok(
    res,
    {
      user: authService.toPublicUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      created,
    },
    created ? 201 : 200,
  );
});

export const requestOtp = asyncHandler(async (req, res) => {
  const result = await authService.requestOtp(req.body.email, req.body.purpose);
  return ok(res, { ...result, message: 'A code is on its way to your inbox.' });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const row = await authService.verifyOtpAndResolve(req.body, { ip: clientIp(req) });
  const tokens = await authService.createSession(row, requestContext(req));
  setRefreshCookie(res, tokens.refreshToken, tokens.expiresAt);
  return ok(res, {
    user: authService.toPublicUser(row),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken ?? (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
  if (!token) throw new UnauthorizedError('No refresh token supplied', 'NO_REFRESH_TOKEN');

  const rotated = await rotateRefreshToken(token, requestContext(req));
  const user = await queryOne<{ id: string; email: string; role: 'admin' | 'organizer' | 'customer' }>(
    "SELECT id, email, role FROM users WHERE id = $1 AND status = 'active'",
    [rotated.userId],
  );
  if (!user) throw new UnauthorizedError('Account is no longer active', 'ACCOUNT_INACTIVE');

  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
  setRefreshCookie(res, rotated.token, rotated.expiresAt);
  return ok(res, { accessToken, refreshToken: rotated.token });
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken ?? (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
  if (token) await revokeRefreshToken(token);
  clearRefreshCookie(res);
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
  clearRefreshCookie(res);
  return ok(res, { message: 'Password updated. Please sign in again.' });
});
