import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ValidationError } from '../utils/errors';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function formatZodError(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Validate and *replace* req.body / req.query / req.params with the parsed
 * result, so handlers receive coerced, trimmed, typed values and unknown keys
 * are stripped rather than silently forwarded into SQL parameter lists.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // Express 5 makes req.query a getter; assigning to the property fails
        // silently there, so redefine it instead.
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new ValidationError(formatZodError(err)));
        return;
      }
      next(err);
    }
  };
}

/** Infer the handler-side type of a schema. */
export type Infer<T extends ZodTypeAny> = z.infer<T>;
