import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchX } from 'lucide-react';
import { fetchPublic, fetchPublicPaged } from '@tixit/session';
import type { HomeFeed, RestaurantCard } from '@/lib/types';
import { ResultRow } from '@/components/restaurant/restaurant-card';
import { EmptyState } from '@/components/ui/feedback';
import { humanTag, plural } from '@/lib/format';
import { Filters } from './filters';
import Link from 'next/link';

type Params = Record<string, string | string[] | undefined>;

function heading(params: Params): string {
  if (params.q) return `“${params.q}”`;
  if (params.tag) return `${humanTag(String(params.tag))} restaurants`;
  if (params.cuisine) return `${params.cuisine} in Jaipur`;
  if (params.openNow) return 'Open right now';
  return 'Restaurants in Jaipur';
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const params = await searchParams;
  return { title: heading(params), description: 'Book a table and pay your bill on Tixit to save instantly.' };
}

export default async function RestaurantsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = Object.fromEntries(
    ['q', 'cuisine', 'tag', 'offers', 'payBill', 'openNow', 'maxCostForTwo', 'sort', 'lat', 'lng', 'page'].map((key) => [
      key,
      typeof params[key] === 'string' ? (params[key] as string) : undefined,
    ]),
  );
  const [result, home] = await Promise.all([
    fetchPublicPaged<RestaurantCard[]>('/dining/restaurants', { city: 'jaipur', limit: 24, ...query }, 30),
    fetchPublic<HomeFeed>('/dining/home', { city: 'jaipur' }, 300),
  ]);
  const items = result?.data ?? [];
  const linkQuery = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as Record<string, string>;
  const page = Number(query.page ?? 1);

  return (
    <div className="container-page py-6 sm:py-10">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{heading(params)}</h1>
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
    </div>
  );
}
