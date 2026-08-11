import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { queryOne } from '../db/pool';
import { verifyAccessToken } from '../modules/auth/token.service';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

export type Role = 'admin' | 'organizer' | 'customer';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  status: 'active' | 'suspended' | 'deleted';
  /** Present only for users with the organizer role. */
  organizerId?: string;
  organizerStatus?: 'pending' | 'verified' | 'rejected' | 'suspended';
}

interface UserRow {
  id: string;
  email: string;
  role: Role;
  full_name: string;
  status: 'active' | 'suspended' | 'deleted';
  organizer_id: string | null;
  organizer_status: 'pending' | 'verified' | 'rejected' | 'suspended' | null;
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.access_token;
  return cookieToken ?? null;
}

/**
 * Resolve the caller from their access token.
 *
 * The user row is re-read on every request rather than trusted from the JWT
 * body: a suspended account or a revoked organizer must lose access
 * immediately, not when their 15-minute token happens to expire.
 */
async function resolveUser(token: string): Promise<AuthenticatedUser> {
  const payload = verifyAccessToken(token);

  const row = await queryOne<UserRow>(
    `SELECT u.id, u.email, u.role, u.full_name, u.status,
            o.id     AS organizer_id,
            o.status AS organizer_status
       FROM users u
       LEFT JOIN organizers o ON o.user_id = u.id
      WHERE u.id = $1`,
    [payload.sub],
  );

  if (!row) throw new UnauthorizedError('Account no longer exists', 'ACCOUNT_MISSING');
  if (row.status === 'suspended') throw new ForbiddenError('This account has been suspended', 'ACCOUNT_SUSPENDED');
  if (row.status === 'deleted') throw new UnauthorizedError('Account no longer exists', 'ACCOUNT_MISSING');

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    status: row.status,
    organizerId: row.organizer_id ?? undefined,
    organizerStatus: row.organizer_status ?? undefined,
  };
}

/** Require a valid access token. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const token = extractToken(req);
  if (!token) {
    next(new UnauthorizedError('Sign in to continue', 'NO_TOKEN'));
    return;
  }
  resolveUser(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
};

/**
 * Attach the user when a token is present, but never reject.
 * Used on public endpoints that personalise their response when signed in.
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = extractToken(req);
  if (!token) {
    next();
    return;
  }
  resolveUser(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => next());
};

/** Require one of the given roles. Must run after `authenticate`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new UnauthorizedError('Sign in to continue', 'NO_TOKEN'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError(`This action requires the ${roles.join(' or ')} role`));
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');

/**
 * Require an organizer profile that admin has verified.
 *
 * Admins pass through so they can operate on organizer resources for support
 * purposes; the individual handlers still scope by organizer id.
 */
export const requireOrganizer: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(new UnauthorizedError('Sign in to continue', 'NO_TOKEN'));
    return;
  }
  if (req.user.role === 'admin') {
    next();
    return;
  }
  if (req.user.role !== 'organizer' || !req.user.organizerId) {
    next(new ForbiddenError('Register as an organizer to access this area', 'NOT_AN_ORGANIZER'));
    return;
  }
  if (req.user.organizerStatus === 'suspended') {
    next(new ForbiddenError('Your organizer account has been suspended', 'ORGANIZER_SUSPENDED'));
    return;
  }
  next();
};

/**
 * Stricter than `requireOrganizer`: blocks organizers who are still awaiting
 * verification. Applied to money-touching actions such as publishing an event.
 */
export const requireVerifiedOrganizer: RequestHandler = (req, _res, next) => {
  requireOrganizer(req, _res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (req.user?.role === 'admin') {
      next();
      return;
    }
    if (req.user?.organizerStatus !== 'verified') {
      next(
        new ForbiddenError(
          'Your organizer account is pending verification by our team',
          'ORGANIZER_NOT_VERIFIED',
        ),
      );
      return;
    }
    next();
  });
};

/** Narrowing helper for handlers that run behind `authenticate`. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

/** The organizer id the caller is acting as. */
export function currentOrganizerId(req: Request): string {
  const user = currentUser(req);
  if (!user.organizerId) throw new ForbiddenError('No organizer profile linked to this account', 'NOT_AN_ORGANIZER');
  return user.organizerId;
}
