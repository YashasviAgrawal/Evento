import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_DINEIN_URL ?? 'http://localhost:3001';
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/partner', '/bills', '/bookings', '/account', '/auth', '/pay/'] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
