import type { MetadataRoute } from 'next';
import { fetchPublicPaged } from '@tixit/session';
import type { RestaurantCard } from '@/lib/types';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_DINEIN_URL ?? 'http://localhost:3001';
  const restaurants: RestaurantCard[] = [];
  for (let page = 1; page <= 200; page += 1) {
    const result = await fetchPublicPaged<RestaurantCard[]>('/dining/restaurants', { limit: 48, page }, 3600);
    restaurants.push(...(result?.data ?? []));
    if (!result?.meta?.hasNext) break;
  }
  return [
    { url: site, changeFrequency: 'daily', priority: 1 },
    { url: `${site}/restaurants`, changeFrequency: 'daily', priority: 0.8 },
    ...restaurants.map((r) => ({ url: `${site}/r/${r.slug}`, changeFrequency: 'weekly' as const, priority: 0.7 })),
  ];
}
