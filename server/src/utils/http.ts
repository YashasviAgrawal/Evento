import type { Request, RequestHandler, Response } from 'express';

/** Envelope every successful response shares, so clients parse one shape. */
export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data });
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export function paginated<T>(res: Response, items: T[], meta: PageMeta): Response {
  return res.status(200).json({ success: true, data: items, meta });
}

export function buildPageMeta(page: number, limit: number, total: number): PageMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return { page, limit, total, totalPages, hasNext: page < totalPages };
}

/**
 * Wrap an async handler so a rejected promise reaches Express's error
 * middleware instead of becoming an unhandled rejection.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: (err?: unknown) => void) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]!.trim();
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}
