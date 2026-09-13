/**
 * Route guards for the CMS.
 *
 * Intentionally not the platform's `authenticate`: these read a different
 * header slot, verify against a different secret, and resolve against a
 * different table. Nothing about a signed-in shopper, organizer or platform
 * admin grants any access through here.
 */
import type { Request, RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../utils/errors';
import { getActiveCmsUser, type CmsUser } from './cms.service';
import { verifyCmsAccessToken } from './cms.token.service';

/**
 * The CMS token travels in its own header and its own cookie.
 *
 * Using `authorization` would mean a browser tab signed into both the site and
 * the CMS sends whichever token the client happened to attach, and a mix-up
 * would read as a confusing 401 rather than as the bug it is. Separate slots
 * make the two sessions genuinely independent.
 */
function extractCmsToken(req: Request): string | null {
  const header = req.headers['x-cms-authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && value.startsWith('Bearer ')) return value.slice(7).trim();

  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.cms_access_token;
  return cookieToken ?? null;
}

/** Require a valid, active CMS account. */
export const authenticateCms: RequestHandler = (req, _res, next) => {
  const token = extractCmsToken(req);
  if (!token) {
    next(new UnauthorizedError('Sign in to the CMS to continue', 'NO_TOKEN'));
    return;
  }

  let payload;
  try {
    payload = verifyCmsAccessToken(token);
  } catch (err) {
    next(err);
    return;
  }

  getActiveCmsUser(payload.sub)
    .then((user) => {
      req.cmsUser = user;
      next();
    })
    .catch(next);
};

/** Managing CMS accounts is admin-only; content is open to every editor. */
export const requireCmsAdmin: RequestHandler = (req, _res, next) => {
  if (!req.cmsUser) {
    next(new UnauthorizedError('Sign in to the CMS to continue', 'NO_TOKEN'));
    return;
  }
  if (req.cmsUser.role !== 'admin') {
    next(new ForbiddenError('Managing CMS accounts requires an admin account', 'CMS_ADMIN_REQUIRED'));
    return;
  }
  next();
};

/** Narrowing helper for handlers that run behind `authenticateCms`. */
export function currentCmsUser(req: Request): CmsUser {
  if (!req.cmsUser) throw new UnauthorizedError('Sign in to the CMS to continue', 'NO_TOKEN');
  return req.cmsUser;
}
