/**
 * Application error taxonomy.
 *
 * Every error thrown deliberately by the app carries an HTTP status and a
 * stable machine-readable `code`, so the frontend can branch on the code
 * rather than pattern-matching human-readable messages.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Invalid request', code = 'BAD_REQUEST', details?: unknown) {
    super(400, code, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Validation failed') {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', code = 'NOT_FOUND') {
    super(404, code, `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT', details?: unknown) {
    super(409, code, message, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please slow down', code = 'RATE_LIMITED') {
    super(429, code, message);
  }
}

export class PaymentError extends AppError {
  constructor(message = 'Payment could not be processed', code = 'PAYMENT_FAILED', details?: unknown) {
    super(402, code, message, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Upstream service unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(503, code, message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
