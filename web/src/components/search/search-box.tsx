'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { CalendarDays, Loader2, MapPin, Search, Tag, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatMoney, friendlyDate } from '@/lib/format';

interface Suggestions {
  events: Array<{
    id: string;
    slug: string;
    title: string;
    startsAt: string;
    thumbnailUrl: string | null;
    minPricePaise: number;
    isFree: boolean;
    cityName: string;
    venueName: string;
  }>;
  cities: Array<{ name: string; slug: string; eventCount: number }>;
  categories: Array<{ name: string; slug: string; color: string }>;
}

const EMPTY: Suggestions = { events: [], cities: [], categories: [] };

/**
 * Search input with type-ahead.
 *
 * Requests are debounced and every in-flight request is aborted when the query
 * changes, so a slow response for "ja" can never overwrite the results for
 * "jazz". Keyboard navigation is wired up because a suggestion list that can
 * only be used with a mouse is worse than no suggestions at all.
 */
export function SearchBox({
  placeholder = 'Search events, artists or venues',
  initialValue = '',
  className,
  inputClassName,
  autoFocus,
  onNavigate,
  onSubmit,
  renderIcon = true,
}: {
  placeholder?: string;
  initialValue?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  onNavigate?: () => void;
  /**
   * Takes over plain Enter (no suggestion highlighted). The hero uses it to run
   * its combined search — text plus city plus date — instead of a bare query.
   */
  onSubmit?: (term: string) => void;
  renderIcon?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<Suggestions>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A flat list of every option, so arrow keys can walk the whole panel.
  const flatOptions = [
    ...suggestions.events.map((e) => ({ kind: 'event' as const, href: `/events/${e.slug}`, label: e.title })),
    ...suggestions.categories.map((c) => ({
      kind: 'category' as const,
      href: `/events?category=${c.slug}`,
      label: c.name,
    })),
    ...suggestions.cities.map((c) => ({ kind: 'city' as const, href: `/events?city=${c.slug}`, label: c.name })),
  ];

  const fetchSuggestions = useCallback(async (term: string) => {
    abortRef.current?.abort();

    if (term.trim().length < 2) {
      setSuggestions(EMPTY);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const { data } = await api.get<Suggestions>('/events/suggest', {
        query: { q: term.trim() },
        auth: false,
        signal: controller.signal,
      });
      setSuggestions(data);
      setActiveIndex(-1);
    } catch {
      // An aborted request is expected, not an error worth surfacing.
      if (!controller.signal.aborted) setSuggestions(EMPTY);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Debounce so we are not firing a request on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void fetchSuggestions(query), 180);
    return () => clearTimeout(timer);
  }, [query, fetchSuggestions]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    onNavigate?.();
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') {
      // Always handled here: this component may sit inside a parent <form>
      // (the hero), and we must not let Enter trigger a native submit while a
      // suggestion is highlighted.
      event.preventDefault();
      const term = query.trim();

      if (activeIndex >= 0 && flatOptions[activeIndex]) {
        go(flatOptions[activeIndex]!.href);
        return;
      }
      setOpen(false);
      if (onSubmit) {
        onSubmit(term);
        onNavigate?.();
        return;
      }
      go(term ? `/events?q=${encodeURIComponent(term)}` : '/events');
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % Math.max(1, flatOptions.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? flatOptions.length - 1 : index - 1));
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const hasResults = flatOptions.length > 0;
  const showPanel = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Intentionally not a <form>: this can be embedded inside one (the
          hero's combined search), and nested forms are invalid HTML. */}
      <div role="search">
        <div className="relative">
          {renderIcon && (
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
              aria-hidden
            />
          )}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="Search events"
            aria-autocomplete="list"
            aria-expanded={showPanel}
            autoFocus={autoFocus}
            className={cn('input pl-9 pr-9', inputClassName)}
          />

          {loading ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-400" aria-hidden />
          ) : query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSuggestions(EMPTY);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 transition hover:text-ink-700"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {showPanel && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-2 max-h-[26rem] animate-fade-up overflow-y-auto rounded-xl border border-ink-200 bg-white py-2 shadow-lift"
        >
          {!hasResults && !loading && (
            <p className="px-4 py-6 text-center text-sm text-ink-500">
              No matches for “{query.trim()}”.{' '}
              <button onClick={() => go(`/events?q=${encodeURIComponent(query.trim())}`)} className="font-medium text-brand-600 hover:underline">
                Search anyway
              </button>
            </p>
          )}

          {suggestions.events.length > 0 && (
            <Section title="Events">
              {suggestions.events.map((event, index) => (
                <button
                  key={event.id}
                  role="option"
                  aria-selected={activeIndex === index}
                  onClick={() => go(`/events/${event.slug}`)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left transition',
                    activeIndex === index ? 'bg-brand-50' : 'hover:bg-ink-50',
                  )}
                >
                  <span className="relative h-11 w-16 shrink-0 overflow-hidden rounded-md bg-ink-100">
                    {event.thumbnailUrl && (
                      <Image src={event.thumbnailUrl} alt="" fill sizes="64px" className="object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">{event.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-500">
                      <CalendarDays className="h-3 w-3 shrink-0" aria-hidden />
                      {friendlyDate(event.startsAt)} · {event.venueName}, {event.cityName}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-ink-700">
                    {event.isFree || event.minPricePaise === 0 ? 'Free' : formatMoney(event.minPricePaise)}
                  </span>
                </button>
              ))}
            </Section>
          )}

          {suggestions.categories.length > 0 && (
            <Section title="Categories">
              {suggestions.categories.map((category, index) => {
                const flatIndex = suggestions.events.length + index;
                return (
                  <button
                    key={category.slug}
                    role="option"
                    aria-selected={activeIndex === flatIndex}
                    onClick={() => go(`/events?category=${category.slug}`)}
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition',
                      activeIndex === flatIndex ? 'bg-brand-50' : 'hover:bg-ink-50',
                    )}
                  >
                    <Tag className="h-3.5 w-3.5 shrink-0" style={{ color: category.color }} aria-hidden />
                    <span className="text-ink-700">{category.name}</span>
                  </button>
                );
              })}
            </Section>
          )}

          {suggestions.cities.length > 0 && (
            <Section title="Cities">
              {suggestions.cities.map((city, index) => {
                const flatIndex = suggestions.events.length + suggestions.categories.length + index;
                return (
                  <button
                    key={city.slug}
                    role="option"
                    aria-selected={activeIndex === flatIndex}
                    onClick={() => go(`/events?city=${city.slug}`)}
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition',
                      activeIndex === flatIndex ? 'bg-brand-50' : 'hover:bg-ink-50',
                    )}
                  >
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
                    <span className="flex-1 text-ink-700">{city.name}</span>
                    <span className="text-xs text-ink-400">{city.eventCount} events</span>
                  </button>
                );
              })}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-ink-100 pb-1.5 last:border-0 last:pb-0">
      <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      {children}
    </div>
  );
}
