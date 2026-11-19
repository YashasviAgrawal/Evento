import type { RequestHandler } from 'express';
import { queryOne } from '../../../db/pool';
import { isUuid } from '../../../utils/ids';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../../utils/errors';

export type MemberRole = 'owner' | 'manager' | 'host' | 'cashier';

/**
 * What each restaurant role may do. One map, so adding a role or moving a
 * capability is a one-line change rather than a hunt through route files.
 */
export const CAPABILITIES = {
  'bills.verify': ['owner', 'manager', 'host', 'cashier'],
  'reservations.manage': ['owner', 'manager', 'host'],
  'offers.manage': ['owner', 'manager'],
  'availability.manage': ['owner', 'manager'],
  'payouts.view': ['owner'],
  'insights.view': ['owner', 'manager'],
} as const satisfies Record<string, readonly MemberRole[]>;
export type Capability = keyof typeof CAPABILITIES;

declare module 'express-serve-static-core' {
  interface Request {
    restaurant?: { id: string; name: string; role: MemberRole | 'admin' };
  }
}

/**
 * Resolve `:restaurantId` against the caller's memberships. Must run after
 * `authenticate`. Platform admins pass for support; every query below still
 * scopes by this id, never by anything else the client sends.
 */
export function requireRestaurantAccess(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) {
      next(new UnauthorizedError());
      return;
    }
    const restaurantId = req.params.restaurantId;
    if (!isUuid(restaurantId)) {
      next(new NotFoundError('Restaurant'));
      return;
    }

    queryOne<{ name: string; role: MemberRole | null }>(
      `SELECT r.name, m.role
         FROM dining.restaurants r
         LEFT JOIN dining.restaurant_members m ON m.restaurant_id = r.id AND m.user_id = $2
        WHERE r.id = $1`,
      [restaurantId, user.id],
    )
      .then((row) => {
        if (!row) throw new NotFoundError('Restaurant');
        if (user.role === 'admin') {
          req.restaurant = { id: restaurantId, name: row.name, role: 'admin' };
          return;
        }
        if (!row.role) throw new NotFoundError('Restaurant');
        if (!(CAPABILITIES[capability] as readonly MemberRole[]).includes(row.role)) {
          throw new ForbiddenError('Your role at this restaurant cannot do that', 'ROLE_NOT_ALLOWED');
        }
        req.restaurant = { id: restaurantId, name: row.name, role: row.role };
      })
      .then(() => next())
      .catch(next);
  };
}

export function capabilitiesFor(role: MemberRole | 'admin'): Capability[] {
  if (role === 'admin') return Object.keys(CAPABILITIES) as Capability[];
  return (Object.keys(CAPABILITIES) as Capability[]).filter((cap) =>
    (CAPABILITIES[cap] as readonly MemberRole[]).includes(role),
  );
}
