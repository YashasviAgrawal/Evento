import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const configDir = path.dirname(fileURLToPath(import.meta.url));

// One .env at the repo root serves every app; real environment variables win.
dotenv.config({ path: path.resolve(configDir, '../.env') });

const publicEnv = Object.fromEntries(
  [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_RAZORPAY_KEY_ID',
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
    'NEXT_PUBLIC_DINEIN_URL',
    'NEXT_PUBLIC_SITE_URL',
  ]
    .map((key) => [key, process.env[key]])
    .filter(([, value]) => typeof value === 'string' && value !== ''),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The repo root, so the standalone build traces files in ../packages too.
  outputFileTracingRoot: path.resolve(configDir, '..'),
  reactStrictMode: true,
  poweredByHeader: false,
  env: publicEnv,
  // Shared Tixit packages are source in ../packages (see packages/README.md).
  experimental: { externalDir: true },
  webpack(config) {
    // Resolve imports inside ../packages from this app's node_modules: one
    // React, one Next, and no install step for the packages.
    config.resolve.modules = [path.join(configDir, 'node_modules'), 'node_modules'];
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'http', hostname: 'localhost' },
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
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
