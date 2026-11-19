'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import { api } from '@tixit/session';
import { rememberCity, type CityOption } from '@/lib/city';
import { cn, plural } from '@/lib/format';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/feedback';

/**
 * "Dining in Jaipur ▾". Lists only cities with restaurants live on Tixit;
 * the choice is remembered in a cookie so every server-rendered page follows.
 */
export function CityPicker({ current, tone = 'night' }: { current: { name: string; slug: string }; tone?: 'night' | 'light' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const cities = useQuery({
    queryKey: ['dining-cities'],
    queryFn: async () => (await api.get<CityOption[]>('/dining/cities', { auth: false })).data,
    enabled: open,
    staleTime: 10 * 60_000,
  });

  function choose(slug: string) {
    rememberCity(slug);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'press inline-flex items-center gap-1.5 rounded-full text-xs font-bold uppercase tracking-[0.12em]',
          tone === 'night' ? 'text-brand-300 hover:text-white' : 'text-brand-600 hover:text-brand-700',
        )}
      >
        <MapPin className="h-3.5 w-3.5" aria-hidden /> Dining in {current.name}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Choose your city" subtitle="More cities are on the way.">
        {cities.isLoading ? (
          <div className="grid h-32 place-items-center">
            <Spinner />
          </div>
        ) : (
          <ul className="space-y-2 pt-1" role="listbox" aria-label="Cities">
            {(cities.data ?? []).map((city) => {
              const selected = city.slug === current.slug;
              return (
                <li key={city.slug}>
                  <button
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(city.slug)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl p-4 text-left ring-1 ring-inset transition',
                      selected ? 'bg-ink-900 text-white ring-ink-900' : 'ring-ink-200 hover:ring-ink-300',
                    )}
                  >
                    <MapPin className={cn('h-5 w-5', selected ? 'text-brand-300' : 'text-brand-600')} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{city.name}</span>
                      <span className={cn('block text-xs', selected ? 'text-ink-300' : 'text-ink-500')}>
                        {city.state} · {plural(city.restaurants, 'restaurant')}
                      </span>
                    </span>
                    {selected && <Check className="h-5 w-5" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </>
  );
}
