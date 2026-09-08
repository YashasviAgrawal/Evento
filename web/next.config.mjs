import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Next only reads .env files sitting next to this config, but the project keeps
 * a single .env at the repo root that both workspaces share. Load it here so
 * NEXT_PUBLIC_* values written there actually reach the browser bundle; a
 * variable already set in the real environment (as on a hosting platform) wins,
 * because dotenv never overwrites what is already defined.
 */
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

/**
 * Inlined explicitly, because Next's automatic NEXT_PUBLIC_ handling only
 * covers variables it loaded from its own .env files — not the ones dotenv
 * just put on process.env.
 *
 * Blank and missing values are omitted rather than inlined as "", so the
 * `process.env.X ?? 'default'` fallbacks in the app still fire. Inlining an
 * empty string would satisfy `??` and quietly defeat every one of them.
 */
const publicEnv = Object.fromEntries(
  [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_RAZORPAY_KEY_ID',
    'NEXT_PUBLIC_SITE_NAME',
    'NEXT_PUBLIC_SITE_URL',
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
  ]
    .map((key) => [key, process.env[key]])
    .filter(([, value]) => typeof value === 'string' && value !== ''),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: publicEnv,
  images: {
    // Event banners come from Cloudinary in production and Unsplash in the
    // demo seed; local uploads are served by the API itself.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
