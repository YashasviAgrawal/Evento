'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, MapPin, Search, TicketCheck } from 'lucide-react';
import type { City } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { SearchBox } from '@/components/search/search-box';

const QUICK_FILTERS = [
  { label: 'Today', href: '/events?when=today' },
  { label: 'Tomorrow', href: '/events?when=tomorrow' },
  { label: 'This Weekend', href: '/events?when=weekend' },
  { label: 'Free Events', href: '/events?price=free' },
];

export function Hero({ cities, stats }: { cities: City[]; stats: { events: number; cities: number } }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [when, setWhen] = useState('');

  /** Combined search: free text plus the city and date pickers beside it. */
  function runSearch(term = query) {
    const params = new URLSearchParams();
    if (term.trim()) params.set('q', term.trim());
    if (city) params.set('city', city);
    if (when) params.set('when', when);
    const qs = params.toString();
    router.push(qs ? `/events?${qs}` : '/events');
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    runSearch();
  }

  return (
    <section className="relative overflow-hidden bg-ink-950">
      {/* Decorative gradient wash — purely presentational. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(225,29,72,0.15),transparent_55%)]" />
      </div>

      <div className="container-page relative py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white backdrop-blur">
            <TicketCheck className="h-3.5 w-3.5" aria-hidden />
            {stats.events}+ live events across {stats.cities} cities
          </span>

          <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Your next great night out,{' '}
            <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">
              one tap away
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-300 sm:text-lg">
            Concerts, comedy, workshops and sport — discover what&apos;s happening near you and book an instant QR
            ticket.
          </p>
        </div>

        <form
          onSubmit={submit}
          role="search"
          className="mx-auto mt-9 max-w-4xl rounded-2xl border border-white/10 bg-white/95 p-2.5 shadow-lift backdrop-blur"
        >
          <div className="flex flex-col gap-2 md:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4.5 w-4.5 -translate-y-1/2 text-ink-400" aria-hidden />
              <SearchBox
                placeholder="Search events, artists or venues"
                initialValue={query}
                renderIcon={false}
                inputClassName="h-12 w-full rounded-lg border-0 bg-transparent pl-11 pr-9 text-sm text-ink-900 shadow-none placeholder:text-ink-400 focus:border-0 focus:outline-none focus:ring-0"
                // Enter runs the hero's combined search (text + city + date)
                // rather than a bare keyword query.
                onSubmit={(term) => {
                  setQuery(term);
                  runSearch(term);
                }}
              />
            </div>

            <div className="relative md:w-44 md:border-l md:border-ink-200">
              <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-ink-400" aria-hidden />
              <select
                value={city}
                onChange={(event) => setCity(event.target.value)}
                aria-label="Filter by city"
                className="h-12 w-full cursor-pointer appearance-none rounded-lg border-0 bg-transparent pl-11 pr-3 text-sm text-ink-900 focus:outline-none focus:ring-0"
              >
                <option value="">All cities</option>
                {cities.map((entry) => (
                  <option key={entry.id} value={entry.slug}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative md:w-40 md:border-l md:border-ink-200">
              <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-ink-400" aria-hidden />
              <select
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                aria-label="Filter by date"
                className="h-12 w-full cursor-pointer appearance-none rounded-lg border-0 bg-transparent pl-11 pr-3 text-sm text-ink-900 focus:outline-none focus:ring-0"
              >
                <option value="">Any date</option>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="weekend">This weekend</option>
                <option value="this_week">Next 7 days</option>
                <option value="this_month">This month</option>
              </select>
            </div>

            <Button type="submit" size="lg" className="h-12 md:px-8">
              Search
            </Button>
          </div>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {QUICK_FILTERS.map((filter) => (
            <Link
              key={filter.href}
              href={filter.href}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-ink-200 backdrop-blur transition hover:border-white/30 hover:bg-white/15 hover:text-white"
            >
              {filter.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
