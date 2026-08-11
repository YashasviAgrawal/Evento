import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import pinoHttp from 'pino-http';
import { logger } from '../config/logger';

/** Assign (or propagate) a request id and echo it on the response. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : crypto.randomUUID();
  res.setHeader('x-request-id', id);
  next();
};

export const httpLogger = pinoHttp({
  logger,
  genReqId: (_req, res) => String(res.getHeader('x-request-id') ?? crypto.randomUUID()),
  // Health checks would otherwise dominate the log volume.
  autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/api/v1/health' },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
