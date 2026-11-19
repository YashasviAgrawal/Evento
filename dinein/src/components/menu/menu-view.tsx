'use client';

import { useMemo, useState } from 'react';
import { Flame, Leaf, UtensilsCrossed } from 'lucide-react';
import type { MenuItem, MenuSection } from '@/lib/types';
import { cn, plural, rupees } from '@/lib/format';
import { Photo } from '@/components/ui/photo';
import { BADGE_LABEL, DietMark } from './diet-mark';

const PREVIEW_ITEMS = 6;

/**
 * The menu on a restaurant page. Read-only by design: diners order from the
 * table as usual and pay the bill on Tixit, so this is for deciding, not
 * checking out. A veg-only switch and section chips do the navigating; long
 * menus open collapsed so the rest of the page stays within reach.
 */
export function MenuView({ sections, restaurantName }: { sections: MenuSection[]; restaurantName: string }) {
  const [vegOnly, setVegOnly] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(
    () =>
      sections
        .filter((section) => active === null || section.id === active)
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => !vegOnly || item.diet === 'veg' || item.diet === 'vegan'),
        }))
        .filter((section) => section.items.length > 0),
    [sections, vegOnly, active],
  );
  const total = visible.reduce((sum, section) => sum + section.items.length, 0);
  const collapsible = total > PREVIEW_ITEMS + 2 && !expanded;

  let budget = collapsible ? PREVIEW_ITEMS : Infinity;
  const shown = visible
    .map((section) => {
      const items = section.items.slice(0, Math.max(0, budget));
      budget -= items.length;
      return { ...section, items };
    })
    .filter((section) => section.items.length > 0);

  return (
    <section className="mt-8" aria-labelledby="menu">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="menu" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <UtensilsCrossed className="h-5 w-5 text-brand-600" /> Menu
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">Prices set by {restaurantName}, before taxes. Offers apply when you pay the bill on Tixit.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={vegOnly}
          onClick={() => setVegOnly((v) => !v)}
          className={cn(
            'press inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-bold ring-1 ring-inset transition',
            vegOnly ? 'bg-emerald-50 text-emerald-800 ring-emerald-300' : 'bg-white text-ink-700 ring-ink-200',
          )}
        >
          <Leaf className="h-4 w-4" /> Veg only
          <span className={cn('relative h-4 w-7 rounded-full transition', vegOnly ? 'bg-emerald-600' : 'bg-ink-200')}>
            <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', vegOnly ? 'left-3.5' : 'left-0.5')} />
          </span>
        </button>
      </div>

      <div className="scrollbar-none -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Menu sections">
        {[{ id: null, name: 'All' }, ...sections].map((section) => (
          <button
            key={section.id ?? 'all'}
            type="button"
            role="tab"
            aria-selected={active === section.id}
            onClick={() => setActive(section.id)}
            className={cn(
              'press shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset transition',
              active === section.id ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-700 ring-ink-200 hover:ring-ink-300',
            )}
          >
            {section.name}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white p-4 text-sm text-ink-500 ring-1 ring-ink-200">No vegetarian dishes in this section.</p>
      ) : (
        <div className="relative mt-4 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
          {shown.map((section) => (
            <div key={section.id}>
              <h3 className="border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-extrabold uppercase tracking-[0.12em] text-ink-500">
                {section.name}
              </h3>
              <ul className="divide-y divide-ink-100">
                {section.items.map((item) => (
                  <MenuRow key={item.id} item={item} />
                ))}
              </ul>
            </div>
          ))}
          {collapsible && (
            <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-white via-white/95 to-transparent pb-4 pt-16">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="press rounded-full bg-ink-900 px-5 py-2.5 text-sm font-bold text-white shadow-lift"
              >
                See full menu · {plural(total, 'dish', 'dishes')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MenuRow({ item }: { item: MenuItem }) {
  return (
    <li className={cn('flex gap-4 p-4', !item.isAvailable && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <DietMark diet={item.diet} />
          {item.badges.map((badge) => (
            <span key={badge} className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-brand-700">
              {BADGE_LABEL[badge]}
            </span>
          ))}
        </div>
        <p className="mt-1 font-bold text-ink-900">{item.name}</p>
        <p className="num mt-0.5 flex items-center gap-2 text-sm font-semibold text-ink-800">
          {rupees(item.pricePaise)}
          {item.spiceLevel > 0 && (
            <span className="inline-flex text-brand-600" aria-label={`Spice level ${item.spiceLevel} of 3`} title={`Spice ${item.spiceLevel}/3`}>
              {Array.from({ length: item.spiceLevel }, (_, i) => (
                <Flame key={i} className="h-3.5 w-3.5 fill-brand-500 stroke-brand-600" aria-hidden />
              ))}
            </span>
          )}
          {!item.isAvailable && <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-600">Sold out today</span>}
        </p>
        {item.description && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-500">{item.description}</p>}
      </div>
      {item.imageUrl && <Photo src={item.imageUrl} alt={item.name} sizes="96px" className="h-24 w-24 shrink-0 rounded-2xl" />}
    </li>
  );
}
