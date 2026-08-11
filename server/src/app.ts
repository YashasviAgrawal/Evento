import path from 'node:path';
import express, { type Express, type Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { healthcheck } from './db/pool';
import { errorHandler, notFoundHandler } from './middleware/error';
import { globalLimiter } from './middleware/rateLimit';
import { httpLogger, requestId } from './middleware/requestContext';
import { asyncHandler, ok } from './utils/http';
import authRoutes from './modules/auth/auth.routes';
import catalogRoutes from './modules/catalog/catalog.routes';
import { organizerEventRoutes, publicEventRoutes } from './modules/events/event.routes';
import bookingRoutes from './modules/bookings/booking.routes';
import paymentRoutes from './modules/payments/payment.routes';
import ticketRoutes from './modules/tickets/ticket.routes';
import organizerRoutes from './modules/organizer/organizer.routes';
import adminRoutes from './modules/admin/admin.routes';
import uploadRoutes, { uploadDir } from './modules/uploads/upload.routes';

export function createApp(): Express {
  const app = express();

  // Required for correct client IPs (and therefore rate limiting) behind a
  // reverse proxy such as nginx, Render or Fly.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(httpLogger);

  app.use(
    helmet({
      // The API serves JSON and uploaded images; it never renders HTML, so the
      // restrictive default CSP would only interfere with image embedding.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/server-to-server requests send no Origin header.
        if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      exposedHeaders: ['x-request-id', 'content-disposition'],
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  /**
   * The Razorpay webhook signature is computed over the raw bytes, so this
   * route must be registered with the raw parser *before* express.json.
   */
  app.use(
    '/api/v1/payments/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (req: Request, _res, next) => {
      if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body;
        try {
          req.body = JSON.parse(req.body.toString('utf8'));
        } catch {
          req.body = {};
        }
      }
      next();
    },
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Locally stored uploads (used when Cloudinary is not configured).
  app.use(
    '/uploads',
    express.static(uploadDir, {
      maxAge: '7d',
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  app.use('/api', globalLimiter);

  /* ───────────────────────── health ───────────────────────── */

  const health = asyncHandler(async (_req, res) => {
    const dbUp = await healthcheck();
    return res.status(dbUp ? 200 : 503).json({
      success: dbUp,
      data: {
        status: dbUp ? 'ok' : 'degraded',
        service: 'evento-api',
        version: '1.0.0',
        environment: env.nodeEnv,
        database: dbUp ? 'up' : 'down',
        integrations: {
          razorpay: env.razorpay.enabled ? 'live' : 'mock',
          email: env.mail.enabled ? 'resend' : 'console',
          storage: env.storage.cloudinaryEnabled ? 'cloudinary' : 'local',
        },
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.get('/health', health);
  app.get('/api/v1/health', health);

  /* ───────────────────────── routes ───────────────────────── */

  const api = express.Router();

  api.use('/auth', authRoutes);
  api.use('/catalog', catalogRoutes);
  api.use('/events', publicEventRoutes);
  api.use('/bookings', bookingRoutes);
  api.use('/payments', paymentRoutes);
  api.use('/tickets', ticketRoutes);
  api.use('/organizer/events', organizerEventRoutes);
  api.use('/organizer', organizerRoutes);
  api.use('/admin', adminRoutes);
  api.use('/uploads', uploadRoutes);

  api.get('/', (_req, res) =>
    ok(res, {
      name: 'Evento API',
      version: 'v1',
      docs: `${env.apiBaseUrl}/api/v1/health`,
    }),
  );

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const projectRoot = path.resolve(__dirname, '..');
