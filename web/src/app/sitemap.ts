import type { MetadataRoute } from 'next';
import { fetchPublic, fetchPublicPaged } from '@/lib/api';
import type { Category, City, EventCard } from '@/lib/types';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002').replace(/\/$/, '');

const STATIC_ROUTES: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }> = [
  { path: '', changeFrequency: 'daily', priority: 1 },
  { path: '/events', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/support', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/list-your-show', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/organizer/register', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/refunds', changeFrequency: 'yearly', priority: 0.3 },
];

/** Every published event, paginated through the public listing endpoint. */
async function listAllPublishedEvents(): Promise<EventCard[]> {
  const events: EventCard[] = [];
  const limit = 50;
  const maxPages = 20; // caps the sitemap at 1,000 events, which is plenty for crawl budget

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPublicPaged<EventCard[]>('/events', { page, limit, sort: 'newest' }, 3600);
    if (!result?.data?.length) break;
    events.push(...result.data);
    if (!result.meta?.hasNext) break;
  }

  return events;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [events, categories, cities] = await Promise.all([
    listAllPublishedEvents(),
    fetchPublic<Category[]>('/catalog/categories', undefined, 3600),
    fetchPublic<City[]>('/catalog/cities', undefined, 3600),
  ]);

  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));

  const eventEntries: MetadataRoute.Sitemap = events.map((event) => ({
    url: `${SITE_URL}/events/${event.slug}`,
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  const categoryEntries: MetadataRoute.Sitemap = (categories ?? []).map((category) => ({
    url: `${SITE_URL}/events?category=${category.slug}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.5,
  }));

  const cityEntries: MetadataRoute.Sitemap = (cities ?? []).map((city) => ({
    url: `${SITE_URL}/events?city=${city.slug}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.5,
  }));

  return [...staticEntries, ...eventEntries, ...categoryEntries, ...cityEntries];
}
