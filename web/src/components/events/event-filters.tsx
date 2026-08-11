'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, X } from 'lucide-react';
import type { Category, City } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/format';

const WHEN_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'weekend', label: 'This Weekend' },
  { value: 'this_week', label: 'Next 7 days' },
  { value: 'this_month', label: 'This month' },
];

const PRICE_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
];

const SORT_OPTIONS = [
  { value: 'date', label: 'Date: soonest' },
  { value: 'popular', label: 'Most popular' },
  { value: 'price_low', label: 'Price: low to high' },
  { value: 'price_high', label: 'Price: high to low' },
  { value: 'newest', label: 'Recently added' },
];

export function EventFilters({
  categories,
  cities,
  total,
}: {
  categories: Category[];
  cities: City[];
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);

  /**
   * Every filter change rewrites the query string, which makes the current
   * result set a shareable, bookmarkable URL and keeps the server component
   * as the single source of truth for what is displayed.
   */
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === '' || params.get(key) === value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const activeFilters = ['q', 'city', 'category', 'when', 'price', 'featured'].filter((key) => searchParams.get(key));

  const filterBody = (
    <div className="space-y-6">
      <FilterGroup title="When">
        <div className="flex flex-wrap gap-2">
          {WHEN_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              active={searchParams.get('when') === option.value}
              onClick={() => setParam('when', option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Price">
        <div className="flex flex-wrap gap-2">
          {PRICE_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              active={searchParams.get('price') === option.value}
              onClick={() => setParam('price', option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Category">
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Chip
              key={category.id}
              active={searchParams.get('category') === category.slug}
              onClick={() => setParam('category', category.slug)}
            >
              {category.name}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="City">
        <select
          value={searchParams.get('city') ?? ''}
          onChange={(event) => setParam('city', event.target.value || null)}
          className="input"
          aria-label="Filter by city"
        >
          <option value="">All cities</option>
          {cities.map((city) => (
            <option key={city.id} value={city.slug}>
              {city.name} {city.eventCount ? `(${city.eventCount})` : ''}
            </option>
          ))}
        </select>
      </FilterGroup>
    </div>
  );

  return (
    <>
      {/* Toolbar — spans both grid columns on desktop */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 lg:col-span-full">
        <p className="text-sm text-ink-500">
          <span className="font-semibold text-ink-900">{total}</span> {total === 1 ? 'event' : 'events'} found
        </p>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilters.length > 0 && (
              <span className="ml-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                {activeFilters.length}
              </span>
            )}
          </Button>

          <select
            value={searchParams.get('sort') ?? 'date'}
            onChange={(event) => setParam('sort', event.target.value)}
            className="input h-9 w-auto py-0 text-sm"
            aria-label="Sort events"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active filter pills */}
      {activeFilters.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 lg:col-span-full">
          {activeFilters.map((key) => (
            <button
              key={key}
              onClick={() => setParam(key, null)}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-2 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-100"
            >
              {key === 'q' ? `“${searchParams.get(key)}”` : searchParams.get(key)}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">Remove {key} filter</span>
            </button>
          ))}
          <button
            onClick={() => router.push(pathname, { scroll: false })}
            className="text-xs font-medium text-ink-500 underline underline-offset-2 hover:text-ink-800"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="mb-5 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-900">
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Filters
          </h2>
          {filterBody}
        </div>
      </aside>

      {/* Mobile sheet */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] animate-fade-up overflow-y-auto rounded-t-2xl bg-white p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-900">Filters</h2>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close filters">
                <X className="h-5 w-5" />
              </Button>
            </div>
            {filterBody}
            <Button className="mt-6 w-full" size="lg" onClick={() => setMobileOpen(false)}>
              Show {total} {total === 1 ? 'event' : 'events'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-ink-300 bg-white text-ink-700 hover:border-ink-400 hover:bg-ink-50',
      )}
    >
      {children}
    </button>
  );
}
