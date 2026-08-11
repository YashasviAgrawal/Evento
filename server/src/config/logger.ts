import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.isTest ? 'silent' : env.logLevel,
  base: undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.otp',
      'res.headers["set-cookie"]',
      '*.password_hash',
      '*.otp_hash',
    ],
    censor: '[redacted]',
  },
  transport: env.isProd || env.isTest ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

export type Logger = typeof logger;
