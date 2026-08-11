import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env';
import { TooManyRequestsError } from '../utils/errors';

/**
 * Rate limits are stored in memory, which is correct for a single instance.
 * Behind more than one API process, swap the store for the Redis store —
 * that is the only change required.
 */
function build(options: Partial<Options> & { windowMs: number; limit: number }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Disabling limits under test keeps the suite from flaking on the 20th call.
    skip: () => env.isTest,
    handler: (_req, _res, next) => next(new TooManyRequestsError(options.message as string | undefined)),
    ...options,
  });
}

/** Broad protection for the whole API surface. */
export const globalLimiter = build({
  windowMs: 60_000,
  limit: 300,
});

/**
 * Credential endpoints. Keyed by email when one is supplied so an attacker
 * cannot lock out a victim by consuming their allowance from another IP,
 * and so rotating IPs does not reset the per-account budget.
 */
export const authLimiter = build({
  windowMs: 15 * 60_000,
  limit: 20,
  message: 'Too many authentication attempts. Try again in a few minutes.',
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return email ? `auth:${email}` : `auth-ip:${req.ip}`;
  },
});

/** OTP requests are the most abusable endpoint — they cost us money to send. */
export const otpLimiter = build({
  windowMs: 10 * 60_000,
  limit: 5,
  message: 'Too many OTP requests. Please wait before requesting another code.',
  keyGenerator: (req: Request) => {
    const identifier = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : req.ip;
    return `otp:${identifier}`;
  },
});

/** Booking creation: generous for humans, tight enough to stop inventory griefing. */
export const bookingLimiter = build({
  windowMs: 60_000,
  limit: 15,
  message: 'Too many booking attempts. Please wait a moment.',
  keyGenerator: (req: Request) => `booking:${req.user?.id ?? req.ip}`,
});

export const uploadLimiter = build({
  windowMs: 60_000,
  limit: 30,
});
