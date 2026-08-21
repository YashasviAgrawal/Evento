import type { MetadataRoute } from 'next';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/account',
          '/account/',
          '/admin',
          '/admin/',
          '/organizer',
          '/organizer/',
          '/checkout',
          '/checkout/',
          '/auth',
          '/auth/',
          '/api/',
        ],
      },
      // The organizer sign-up page is public marketing content, not a dashboard route.
      { userAgent: '*', allow: '/organizer/register' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
