import path from 'node:path';
import dotenv from 'dotenv';

// Load the repo-root .env first, then allow server/.env to override it.
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

function str(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${key} must be a number, got "${raw}"`);
  return parsed;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function list(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const nodeEnv = str('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';

/**
 * Secrets must never silently fall back to a development default in
 * production — a predictable JWT secret is a full account-takeover bug.
 */
function secret(key: string, devFallback: string): string {
  const value = optional(key);
  if (value) return value;
  if (isProd) throw new Error(`${key} must be set in production`);
  return devFallback;
}

export const env = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  isDev: nodeEnv === 'development',

  port: num('PORT', 4000),
  apiBaseUrl: str('API_BASE_URL', 'http://localhost:4000'),
  webBaseUrl: str('WEB_BASE_URL', 'http://localhost:3000'),
  corsOrigins: list('CORS_ORIGINS', ['http://localhost:3000']),
  logLevel: str('LOG_LEVEL', isProd ? 'info' : 'debug'),

  db: {
    url: str('DATABASE_URL', 'postgresql://evento:evento@127.0.0.1:5432/evento'),
    ssl: bool('DATABASE_SSL', false),
    poolMax: num('PG_POOL_MAX', 10),
  },

  auth: {
    accessSecret: secret('JWT_ACCESS_SECRET', 'dev-access-secret-change-me-0123456789abcdef'),
    refreshSecret: secret('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me-0123456789abcdef'),
    accessTtl: str('JWT_ACCESS_TTL', '15m'),
    refreshTtl: str('JWT_REFRESH_TTL', '30d'),
    bcryptRounds: num('BCRYPT_ROUNDS', 10),
  },

  otp: {
    ttlMinutes: num('OTP_TTL_MINUTES', 10),
    maxAttempts: num('OTP_MAX_ATTEMPTS', 5),
    // Never echo the OTP back to the caller outside development.
    devEcho: bool('OTP_DEV_ECHO', true) && !isProd,
  },

  qr: {
    secret: secret('QR_SECRET', 'dev-qr-secret-change-me-0123456789abcdef'),
  },

  razorpay: {
    keyId: optional('RAZORPAY_KEY_ID'),
    keySecret: optional('RAZORPAY_KEY_SECRET'),
    webhookSecret: optional('RAZORPAY_WEBHOOK_SECRET'),
    currency: str('CURRENCY', 'INR'),
    get enabled(): boolean {
      return Boolean(optional('RAZORPAY_KEY_ID') && optional('RAZORPAY_KEY_SECRET'));
    },
  },

  mail: {
    resendApiKey: optional('RESEND_API_KEY'),
    from: str('MAIL_FROM', 'Tixit <tickets@tixit.in>'),
    get enabled(): boolean {
      return Boolean(optional('RESEND_API_KEY'));
    },
  },

  storage: {
    cloudName: optional('CLOUDINARY_CLOUD_NAME'),
    apiKey: optional('CLOUDINARY_API_KEY'),
    apiSecret: optional('CLOUDINARY_API_SECRET'),
    uploadDir: str('UPLOAD_DIR', 'uploads'),
    maxUploadMb: num('MAX_UPLOAD_MB', 8),
    get cloudinaryEnabled(): boolean {
      return Boolean(
        optional('CLOUDINARY_CLOUD_NAME') && optional('CLOUDINARY_API_KEY') && optional('CLOUDINARY_API_SECRET'),
      );
    },
  },

  business: {
    defaultCommissionPercent: num('DEFAULT_COMMISSION_PERCENT', 10),
    bookingHoldMinutes: num('BOOKING_HOLD_MINUTES', 15),
    defaultTaxPercent: num('DEFAULT_TAX_PERCENT', 18),
    defaultConvenienceFeePercent: num('DEFAULT_CONVENIENCE_FEE_PERCENT', 2),
  },
} as const;

export type Env = typeof env;
