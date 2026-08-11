import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchPublic, fetchPublicPaged } from '@/lib/api';
import type { Category, City, EventCard as EventCardType } from '@/lib/types';
import { EventCard } from '@/components/events/event-card';
import { EventFilters } from '@/components/events/event-filters';
import { EmptyState } from '@/components/ui/index';
import { ButtonLink } from '@/components/ui/button';
import { cn } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Browse events',
  description: 'Search and filter concerts, comedy nights, workshops and sport across India.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  const query = {
    q: first(params.q),
    city: first(params.city),
    category: first(params.category),
    when: first(params.when),
    date: first(params.date),
    price: first(params.price),
    featured: first(params.featured),
    organizer: first(params.organizer),
    sort: first(params.sort) ?? 'date',
    page: Number(first(params.page) ?? 1),
    limit: 12,
  };

  const [result, categories, cities] = await Promise.all([
    fetchPublicPaged<EventCardType[]>('/events', query, 15),
    fetchPublic<Category[]>('/catalog/categories', undefined, 300),
    fetchPublic<City[]>('/catalog/cities', {
      category: query.category,
      price: query.price,
      when: query.when,
      date: query.date,
      q: query.q,
      featured: query.featured,
      organizer: query.organizer,
    }, 15),
  ]);

  const events = result?.data ?? [];
  const meta = result?.meta;
  const heading = buildHeading(query);

  return (
    <div className="container-page py-8 lg:py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-500">
        <Link href="/" className="hover:text-ink-800">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-800">Events</span>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{heading}</h1>

      <div className="mt-7 grid gap-7 lg:grid-cols-[260px_1fr]">
        <Suspense fallback={<div className="hidden h-96 rounded-xl bg-white lg:block" />}>
          <EventFilters categories={categories ?? []} cities={cities ?? []} total={meta?.total ?? 0} />
        </Suspense>

        <div className="min-w-0">
          {events.length === 0 ? (
            <EmptyState
              icon={<CalendarX2 className="h-10 w-10" />}
              title="No events match those filters"
              description="Try widening your search — a different city, a later date, or clear a filter or two."
              action={<ButtonLink href="/events">Clear all filters</ButtonLink>}
            />
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {events.map((event, index) => (
                  <EventCard key={event.id} event={event} priority={index < 3} />
                ))}
              </div>

              {meta && meta.totalPages > 1 && <Pagination meta={meta} params={params} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function buildHeading(query: { q?: string; city?: string; category?: string; when?: string; price?: string }): string {
  if (query.q) return `Results for “${query.q}”`;

  const parts: string[] = [];
  if (query.price === 'free') parts.push('Free events');
  else if (query.category) parts.push(`${capitalise(query.category)} events`);
  else parts.push('All events');

  if (query.city) parts.push(`in ${capitalise(query.city)}`);
  if (query.when === 'today') parts.push('today');
  if (query.when === 'tomorrow') parts.push('tomorrow');
  if (query.when === 'weekend') parts.push('this weekend');

  return parts.join(' ');
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, ' ');
}

function Pagination({
  meta,
  params,
}: {
  meta: { page: number; totalPages: number };
  params: SearchParams;
}) {
  function hrefFor(page: number): string {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const single = first(value);
      if (single && key !== 'page') next.set(key, single);
    }
    if (page > 1) next.set('page', String(page));
    const qs = next.toString();
    return qs ? `/events?${qs}` : '/events';
  }

  // Show a compact window around the current page rather than every page.
  const pages: number[] = [];
  const start = Math.max(1, meta.page - 2);
  const end = Math.min(meta.totalPages, start + 4);
  for (let page = start; page <= end; page += 1) pages.push(page);

  return (
    <nav className="mt-10 flex items-center justify-center gap-1.5" aria-label="Pagination">
      <PageLink href={hrefFor(meta.page - 1)} disabled={meta.page <= 1} aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" />
      </PageLink>

      {start > 1 && (
        <>
          <PageLink href={hrefFor(1)}>1</PageLink>
          {start > 2 && <span className="px-1 text-ink-400">…</span>}
        </>
      )}

      {pages.map((page) => (
        <PageLink key={page} href={hrefFor(page)} active={page === meta.page}>
          {page}
        </PageLink>
      ))}

      {end < meta.totalPages && (
        <>
          {end < meta.totalPages - 1 && <span className="px-1 text-ink-400">…</span>}
          <PageLink href={hrefFor(meta.totalPages)}>{meta.totalPages}</PageLink>
        </>
      )}

      <PageLink href={hrefFor(meta.page + 1)} disabled={meta.page >= meta.totalPages} aria-label="Next page">
        <ChevronRight className="h-4 w-4" />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  active,
  disabled,
  children,
  ...props
}: {
  href: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  'aria-label'?: string;
}) {
  const className = cn(
    'grid h-9 min-w-9 place-items-center rounded-lg border px-3 text-sm font-medium transition',
    active
      ? 'border-brand-600 bg-brand-600 text-white'
      : 'border-ink-300 bg-white text-ink-700 hover:border-ink-400 hover:bg-ink-50',
    disabled && 'pointer-events-none opacity-40',
  );

  if (disabled) {
    return (
      <span className={className} aria-disabled {...props}>
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={className} aria-current={active ? 'page' : undefined} {...props}>
      {children}
    </Link>
  );
}

