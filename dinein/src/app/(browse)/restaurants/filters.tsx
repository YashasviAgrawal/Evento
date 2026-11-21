'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { LocateFixed, Search, SlidersHorizontal, X } from 'lucide-react';
import { Chip } from '@/components/ui/controls';
import { Sheet } from '@/components/ui/sheet';
import { cn, humanTag } from '@/lib/format';

const TAGS = ['rooftop', 'date-night', 'bar', 'pure-veg', 'live-music', 'heritage', 'family', 'cafe', 'outdoor'];
const SORTS = [
  { value: 'relevance', label: 'Recommended' },
  { value: 'offer', label: 'Biggest offer' },
  { value: 'rating', label: 'Top rated' },
  { value: 'distance', label: 'Nearest' },
  { value: 'cost_low', label: 'Cost: low to high' },
  { value: 'cost_high', label: 'Cost: high to low' },
];
const BUDGETS = [
  { value: '800', label: 'Under ₹800' },
  { value: '1500', label: 'Under ₹1,500' },
  { value: '2500', label: 'Under ₹2,500' },
];

/**
 * All state lives in the URL: results are shareable, crawlable and survive
 * Back. Quick toggles sit in one scrollable row; the rest is one sheet away.
 */
export function Filters({ cuisines }: { cuisines: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [q, setQ] = useState(params.get('q') ?? '');

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    startTransition(() => router.replace(`/restaurants${next.size ? `?${next}` : ''}`, { scroll: false }));
  }

  const toggle = (key: string, value = '1') => update({ [key]: params.get(key) === value ? null : value });

  function nearMe(extra: Record<string, string> = {}) {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        update({ lat: position.coords.latitude.toFixed(5), lng: position.coords.longitude.toFixed(5), sort: 'distance', ...extra });
      },
      () => setLocating(false),
      { timeout: 8000, maximumAge: 300_000 },
    );
  }

  const advancedCount = ['cuisine', 'maxCostForTwo', 'payBill'].filter((key) => params.get(key)).length +
    (params.get('sort') && params.get('sort') !== 'relevance' ? 1 : 0);
  const hasLocation = Boolean(params.get('lat'));

  return (
    <div className={cn('transition-opacity', pending && 'opacity-60')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: q.trim() || null });
        }}
        role="search"
        className="flex items-center gap-2"
      >
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-2xl bg-white px-4 ring-1 ring-inset ring-ink-200 focus-within:ring-2 focus-within:ring-brand-500">
          <Search className="h-4.5 w-4.5 shrink-0 text-ink-400" aria-hidden />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search restaurants, cuisines, areas"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] focus:outline-none"
            aria-label="Search"
            enterKeyHint="search"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                update({ q: null });
              }}
              aria-label="Clear search"
              className="grid h-6 w-6 place-items-center rounded-full bg-ink-200 text-ink-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="press relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white ring-1 ring-inset ring-ink-200 hover:ring-ink-300"
          aria-label="More filters"
        >
          <SlidersHorizontal className="h-5 w-5 text-ink-700" />
          {advancedCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
              {advancedCount}
            </span>
          )}
        </button>
      </form>

      <div className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip active={hasLocation} onClick={hasLocation ? () => update({ lat: null, lng: null, sort: null, maxKm: null }) : () => nearMe()}>
          <LocateFixed className="h-3.5 w-3.5" /> {locating ? 'Locating…' : 'Near me'}
        </Chip>
        <Chip
          active={params.get('maxKm') === '5'}
          onClick={() => (params.get('maxKm') === '5' ? update({ maxKm: null }) : hasLocation ? update({ maxKm: '5' }) : nearMe({ maxKm: '5' }))}
        >
          Within 5 km
        </Chip>
        <Chip active={params.get('booking') === '1'} onClick={() => toggle('booking')}>
          Book a table
        </Chip>
        <Chip active={params.get('openNow') === '1'} onClick={() => toggle('openNow')}>
          Open now
        </Chip>
        <Chip active={params.get('offers') === '1'} onClick={() => toggle('offers')}>
          With offers
        </Chip>
        <Chip active={params.get('minRating') === '4.5'} onClick={() => toggle('minRating', '4.5')}>
          Rating 4.5+
        </Chip>
        {TAGS.map((tag) => (
          <Chip key={tag} active={params.get('tag') === tag} onClick={() => toggle('tag', tag)}>
            {humanTag(tag)}
          </Chip>
        ))}
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        footer={
          <div className="flex gap-2 pb-1">
            <button
              onClick={() => update({ cuisine: null, maxCostForTwo: null, payBill: null, sort: null })}
              className="press h-12 flex-1 rounded-2xl font-bold text-ink-700 ring-1 ring-inset ring-ink-300"
            >
              Reset
            </button>
            <button onClick={() => setOpen(false)} className="press h-12 flex-[2] rounded-2xl bg-ink-900 font-bold text-white">
              Show restaurants
            </button>
          </div>
        }
      >
        <FilterGroup title="Sort by">
          {SORTS.map((sort) => (
            <Chip
              key={sort.value}
              active={(params.get('sort') ?? 'relevance') === sort.value}
              onClick={() => (sort.value === 'distance' && !hasLocation ? nearMe() : update({ sort: sort.value === 'relevance' ? null : sort.value }))}
            >
              {sort.label}
            </Chip>
          ))}
        </FilterGroup>
        <FilterGroup title="Cost for two">
          {BUDGETS.map((budget) => (
            <Chip key={budget.value} active={params.get('maxCostForTwo') === budget.value} onClick={() => toggle('maxCostForTwo', budget.value)}>
              {budget.label}
            </Chip>
          ))}
        </FilterGroup>
        <FilterGroup title="Cuisine">
          {cuisines.map((cuisine) => (
            <Chip key={cuisine} active={params.get('cuisine') === cuisine} onClick={() => toggle('cuisine', cuisine)}>
              {cuisine}
            </Chip>
          ))}
        </FilterGroup>
        <FilterGroup title="Payments">
          <Chip active={params.get('payBill') === '1'} onClick={() => toggle('payBill')}>
            Pay bill on Tixit
          </Chip>
        </FilterGroup>
      </Sheet>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-5 first:mt-2">
      <legend className="eyebrow mb-2.5 text-ink-400">{title}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}
