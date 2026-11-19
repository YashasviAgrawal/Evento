import { ArrowRight, UtensilsCrossed } from 'lucide-react';
import { fetchPublic } from '@/lib/api';
import { dineinUrl, type DineinHome } from '@/lib/dinein';
import { DineinCard } from './dinein-card';

/**
 * "Dine-in near you" on the events home: the other half of a night out, one
 * account away. Renders nothing if dine-in is unreachable, so the events page
 * never breaks because of it.
 */
export async function DineinRail() {
  const feed = await fetchPublic<DineinHome>('/dining/home', { city: 'jaipur' }, 300);
  const cards = feed?.bestOffers.length ? feed.bestOffers : feed?.topRated;
  if (!feed || !cards?.length) return null;

  return (
    <section className="container-page py-12">
      <div className="overflow-hidden rounded-3xl bg-ink-950 p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-brand-300">
              <UtensilsCrossed className="h-3.5 w-3.5" /> New · Tixit Dine-in
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Dinner before the show?</h2>
            <p className="mt-1 text-sm text-ink-300">
              Book a table in {feed.city.name} and pay the bill on Tixit — offers apply on their own. Same account.
            </p>
          </div>
          <a
            href={dineinUrl('/')}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-bold text-ink-900 transition hover:bg-ink-100"
          >
            Explore Dine-in <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <div className="-mx-6 mt-6 flex snap-x gap-4 overflow-x-auto px-6 pb-2 sm:-mx-8 sm:px-8 [scrollbar-width:none]">
          {cards.slice(0, 8).map((card) => (
            <DineinCard key={card.id} card={card} />
          ))}
        </div>
      </div>
    </section>
  );
}
