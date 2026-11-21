import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChevronDown, SearchX } from 'lucide-react';
import { fetchPublic, fetchPublicPaged } from '@tixit/session';
import type { HomeFeed, RestaurantCard } from '@/lib/types';
import { ResultRow } from '@/components/restaurant/restaurant-card';
import { EmptyState } from '@/components/ui/feedback';
import { humanTag, plural } from '@/lib/format';
import { Filters } from './filters';
import Link from 'next/link';
import { CityPicker } from '@/components/shell/city-picker';
import { currentCity } from '@/lib/city.server';

type Params = Record<string, string | string[] | undefined>;

const SITE_URL = process.env.NEXT_PUBLIC_DINEIN_URL ?? 'http://localhost:3001';

function heading(params: Params, cityName: string): string {
  if (params.q) return `“${params.q}”`;
  if (params.lat && params.lng) return 'Restaurants nearby';
  if (params.tag) return `${humanTag(String(params.tag))} restaurants`;
  if (params.cuisine) return `${params.cuisine} in ${cityName}`;
  if (params.openNow) return 'Open right now';
  if (params.minRating) return `Rated ${params.minRating}+ in ${cityName}`;
  return `Restaurants in ${cityName}`;
}

const cityName = (slug: string, home: HomeFeed | null) => home?.city.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const params = await searchParams;
  const city = await currentCity(params.city);
  const home = await fetchPublic<HomeFeed>('/dining/home', { city }, 300);
  return { title: heading(params, cityName(city, home)), description: 'Book a table and pay your bill on Tixit to save instantly.' };
}

export default async function RestaurantsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = Object.fromEntries(
    ['q', 'cuisine', 'tag', 'offers', 'payBill', 'openNow', 'maxCostForTwo', 'minRating', 'booking', 'maxKm', 'sort', 'lat', 'lng', 'page'].map((key) => [
      key,
      typeof params[key] === 'string' ? (params[key] as string) : undefined,
    ]),
  );
  const city = await currentCity(params.city);
  // A search around a point (e.g. "eat near the venue") crosses city lines.
  const nearby = Boolean(query.lat && query.lng);
  const [result, home] = await Promise.all([
    fetchPublicPaged<RestaurantCard[]>('/dining/restaurants', { city: nearby ? undefined : city, limit: 24, ...query }, 30),
    fetchPublic<HomeFeed>('/dining/home', { city }, 300),
  ]);
  const items = result?.data ?? [];
  const linkQuery = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as Record<string, string>;
  const page = Number(query.page ?? 1);
  const name = cityName(city, home);
  const title = heading(params, name);
  const filtered = title !== heading({}, name);

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: `${name} restaurants`, href: '/restaurants' },
    ...(filtered ? [{ label: title.replace(/[“”]/g, ''), href: null }] : []),
  ];
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      ...(crumb.href ? { item: `${SITE_URL}${crumb.href}` } : {}),
    })),
  };

  return (
    <div className="container-page py-6 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-ink-400">
        <ol className="flex flex-wrap items-center gap-1.5">
          {crumbs.map((crumb, index) => (
            <li key={crumb.label} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden>/</span>}
              {crumb.href && (index < crumbs.length - 1) ? (
                <Link href={crumb.href} className="hover:text-ink-700">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-ink-600">
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {!nearby && <CityPicker tone="light" current={{ name, slug: city }} />}
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-1 text-sm text-ink-500">
        {result ? plural(result.meta?.total ?? items.length, 'place') : 'Searching…'} · offers apply when you pay the bill on Tixit
      </p>

      <div className="sticky top-16 z-30 -mx-4 mt-5 bg-ink-50/90 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Suspense>
          <Filters cuisines={home?.cuisines.map((c) => c.name) ?? []} />
        </Suspense>
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={SearchX}
          title="Nothing matches that yet"
          body="Try a different dish or area, or clear a filter or two."
          action={
            <Link href="/restaurants" className="press inline-flex h-11 items-center rounded-2xl bg-ink-900 px-5 text-sm font-bold text-white">
              Clear all filters
            </Link>
          }
        />
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {items.map((card) => (
            <li key={card.id}>
              <ResultRow card={card} />
            </li>
          ))}
        </ul>
      )}

      {result?.meta && result.meta.totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pages">
          {page > 1 && (
            <Link
              href={{ pathname: '/restaurants', query: { ...linkQuery, page: page - 1 } }}
              className="press rounded-full bg-white px-4 py-2 text-sm font-bold ring-1 ring-ink-200"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-ink-500">
            Page {page} of {result.meta.totalPages}
          </span>
          {result.meta.hasNext && (
            <Link
              href={{ pathname: '/restaurants', query: { ...linkQuery, page: page + 1 } }}
              className="press rounded-full bg-white px-4 py-2 text-sm font-bold ring-1 ring-ink-200"
            >
              Next
            </Link>
          )}
        </nav>
      )}

      {home && !nearby && <Explore city={name} home={home} />}
    </div>
  );
}

/**
 * Crawlable shortcuts into the city — cuisines, areas and collections — folded
 * away so they help search engines and browsers without crowding results.
 */
function Explore({ city, home }: { city: string; home: HomeFeed }) {
  const groups = [
    {
      title: `Popular cuisines in ${city}`,
      links: home.cuisines.map((c) => ({ label: `${c.name} restaurants`, href: `/restaurants?cuisine=${encodeURIComponent(c.name)}`, count: c.count })),
    },
    {
      title: `Restaurants in popular areas of ${city}`,
      links: (home.localities ?? []).map((l) => ({ label: `Restaurants in ${l.name}`, href: `/restaurants?q=${encodeURIComponent(l.name)}`, count: l.count })),
    },
    {
      title: 'Collections',
      links: home.collections.map((c) => ({ label: c.title, href: `/collections/${c.slug}`, count: c.count })),
    },
  ].filter((group) => group.links.length > 0);

  if (groups.length === 0) return null;
  return (
    <section className="mt-14" aria-labelledby="explore">
      <h2 id="explore" className="text-xl font-extrabold tracking-tight sm:text-2xl">
        Explore {city}
      </h2>
      <div className="mt-4 space-y-3">
        {groups.map((group) => (
          <details key={group.title} className="group rounded-2xl bg-white ring-1 ring-ink-200 open:pb-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-bold text-ink-800">
              {group.title}
              <ChevronDown className="h-5 w-5 shrink-0 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 px-5">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-ink-600 hover:text-brand-700">
                    {link.label} <span className="text-ink-400">({link.count})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
