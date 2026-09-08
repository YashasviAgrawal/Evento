'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react';
import type { City } from '@/lib/types';
import { cn } from '@/lib/format';

/**
 * Searchable city combobox.
 *
 * The catalogue spans every state and union territory of India (hundreds of
 * entries), which a plain <select> handles badly — so this keeps the nine
 * popular cities one click away while letting anyone type their way to the
 * rest. The rendered list is capped so opening the picker never mounts a
 * thousand nodes; the search box is how you reach the tail.
 */

type CityKey = 'id' | 'slug' | 'name';

const MAX_VISIBLE = 60;

interface CityPickerProps {
  cities: City[];
  value: string;
  onChange: (value: string) => void;
  /** Which city field the form stores. Defaults to the UUID. */
  valueKey?: CityKey;
  /** Placeholder inside the search box. */
  placeholder?: string;
  /** Trigger text while nothing is selected. Defaults to `allLabel`. */
  emptyLabel?: string;
  /** When set, adds a row (and a clear button) that empties the selection. */
  allLabel?: string;
  /** Append the event count to each row — only useful on discovery surfaces. */
  showCounts?: boolean;
  /** Show ", State" beside the city name. */
  showState?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  /** Overrides the trigger styling; defaults to the shared `.input` look. */
  triggerClassName?: string;
  ariaLabel?: string;
}

interface Option {
  value: string;
  label: string;
  state: string;
  count: number;
  isPopular: boolean;
}

function toOption(city: City, key: CityKey): Option {
  return {
    value: key === 'id' ? city.id : key === 'slug' ? city.slug : city.name,
    label: city.name,
    state: city.state,
    count: city.eventCount ?? 0,
    isPopular: Boolean(city.isPopular),
  };
}

/** Rank matches so "Pun" puts Pune above Nandyal's state match. */
function score(option: Option, needle: string): number {
  const name = option.label.toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  if (option.state.toLowerCase().startsWith(needle)) return 3;
  if (option.state.toLowerCase().includes(needle)) return 4;
  return -1;
}

export function CityPicker({
  cities,
  value,
  onChange,
  valueKey = 'id',
  placeholder = 'Search for a city…',
  emptyLabel,
  allLabel,
  showCounts = false,
  showState = true,
  invalid = false,
  disabled = false,
  className,
  triggerClassName,
  ariaLabel = 'City',
}: CityPickerProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const options = useMemo(() => cities.map((city) => toOption(city, valueKey)), [cities, valueKey]);
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);

  const needle = queryText.trim().toLowerCase();

  /** Popular first when idle, best-match order once the user types. */
  const { visible, totalMatches } = useMemo(() => {
    if (!needle) {
      const popular = options.filter((option) => option.isPopular);
      const rest = options.filter((option) => !option.isPopular);
      return { visible: [...popular, ...rest].slice(0, MAX_VISIBLE), totalMatches: options.length };
    }
    const matches = options
      .map((option) => ({ option, rank: score(option, needle) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.option.label.localeCompare(b.option.label))
      .map((entry) => entry.option);
    return { visible: matches.slice(0, MAX_VISIBLE), totalMatches: matches.length };
  }, [needle, options]);

  // The optional "clear" row sits at index 0 so keyboard navigation can treat
  // everything as one flat list.
  const rows: Array<Option | null> = allLabel ? [null, ...visible] : visible;

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function close() {
    setOpen(false);
    setQueryText('');
    setActiveIndex(0);
  }

  function pick(option: Option | null) {
    onChange(option ? option.value : '');
    close();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + delta + rows.length) % rows.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (rows.length > 0) pick(rows[activeIndex] ?? null);
    }
  }

  const triggerLabel = selected
    ? showState && selected.state
      ? `${selected.label}, ${selected.state}`
      : selected.label
    : null;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          'input flex w-full cursor-pointer items-center gap-2 text-left',
          invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-100',
          disabled && 'cursor-not-allowed opacity-60',
          triggerClassName,
        )}
      >
        <MapPin className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
        <span className={cn('flex-1 truncate', !triggerLabel && 'text-ink-400')}>
          {triggerLabel ?? emptyLabel ?? allLabel ?? 'Select a city…'}
        </span>
        {selected && allLabel && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear city"
            onClick={(event) => {
              event.stopPropagation();
              onChange('');
            }}
            className="shrink-0 rounded p-0.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-400 transition', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div className="absolute z-40 mt-1.5 w-full overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lift">
          <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            <input
              ref={searchRef}
              value={queryText}
              onChange={(event) => {
                setQueryText(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-controls={listboxId}
              aria-autocomplete="list"
              role="combobox"
              aria-expanded={open}
              className="w-full border-0 bg-transparent py-1 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-0"
            />
          </div>

          <ul ref={listRef} id={listboxId} role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto py-1">
            {rows.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-ink-500">
                No city matches “{queryText.trim()}”
              </li>
            )}

            {rows.map((option, index) => {
              const isActive = index === activeIndex;
              const isSelected = option ? option.value === value : !value;
              const showPopularHeading = !needle && option?.isPopular && index === (allLabel ? 1 : 0);
              const showAllHeading =
                !needle && option !== null && !option.isPopular && (rows[index - 1] as Option | null)?.isPopular;

              return (
                <li key={option ? option.value : '__all__'}>
                  {showPopularHeading && <Heading>Popular cities</Heading>}
                  {showAllHeading && <Heading>All cities across India</Heading>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pick(option)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition',
                      isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-ink-50',
                    )}
                  >
                    <span className="flex-1 truncate">
                      {option ? (
                        <>
                          <span className="font-medium text-ink-900">{option.label}</span>
                          {showState && option.state && <span className="text-ink-500">, {option.state}</span>}
                        </>
                      ) : (
                        <span className="font-medium text-ink-900">{allLabel}</span>
                      )}
                    </span>
                    {showCounts && option && option.count > 0 && (
                      <span className="shrink-0 text-xs text-ink-400">{option.count}</span>
                    )}
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>

          {totalMatches > visible.length && (
            <p className="border-t border-ink-100 px-3 py-2 text-xs text-ink-500">
              Showing {visible.length} of {totalMatches} cities — keep typing to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{children}</p>
  );
}
