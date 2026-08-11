import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';

/** Terminal 404 handler for unmatched routes. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
};

/** PostgreSQL error codes we can turn into a meaningful client response. */
function translatePostgresError(err: { code?: string; constraint?: string; detail?: string }): AppError | null {
  switch (err.code) {
    case '23505': // unique_violation
      return new AppError(409, 'DUPLICATE', friendlyDuplicateMessage(err.constraint), { constraint: err.constraint });
    case '23503': // foreign_key_violation
      return new AppError(400, 'INVALID_REFERENCE', 'A referenced record does not exist', {
        constraint: err.constraint,
      });
    case '23514': // check_violation
      return new AppError(409, 'CONSTRAINT_VIOLATION', friendlyCheckMessage(err.constraint), {
        constraint: err.constraint,
      });
    case '22P02': // invalid_text_representation
      return new AppError(400, 'INVALID_INPUT', 'One of the supplied values has the wrong format');
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new AppError(409, 'CONCURRENT_UPDATE', 'That request collided with another, please retry');
    default:
      return null;
  }
}

function friendlyDuplicateMessage(constraint?: string): string {
  switch (constraint) {
    case 'users_email_key':
      return 'An account with this email already exists';
    case 'users_phone_key':
      return 'An account with this phone number already exists';
    case 'coupons_code_key':
      return 'A coupon with this code already exists';
    case 'events_slug_key':
      return 'An event with this URL already exists';
    default:
      return 'That record already exists';
  }
}

function friendlyCheckMessage(constraint?: string): string {
  if (constraint === 'ticket_types_not_oversold') {
    return 'Not enough tickets remaining for this selection';
  }
  return 'The request violates a data constraint';
}

/**
 * Central error handler.
 *
 * 4xx errors are returned to the client with their code and details; 5xx
 * errors are logged in full and reduced to a generic message so internal
 * details never leak. Every response carries the request id for support.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = new ValidationError(err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  } else if (err && typeof err === 'object' && 'code' in err) {
    appError =
      translatePostgresError(err as { code?: string; constraint?: string }) ??
      new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side');
  } else {
    appError = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side');
  }

  const requestId = res.getHeader('x-request-id');

  if (appError.status >= 500) {
    logger.error({ err, path: req.path, method: req.method, requestId }, 'Unhandled error');
  } else {
    logger.debug({ code: appError.code, path: req.path, requestId }, appError.message);
  }

  res.status(appError.status).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'Something went wrong on our side',
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      ...(requestId ? { requestId } : {}),
      ...(env.isProd || appError.status < 500 ? {} : { stack: (err as Error)?.stack }),
    },
  });
};
