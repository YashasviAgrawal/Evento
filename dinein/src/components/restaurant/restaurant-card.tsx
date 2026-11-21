import Link from 'next/link';
import { BadgePercent, MapPin } from 'lucide-react';
import type { RestaurantCard as Card } from '@/lib/types';
import { cn, distanceLabel, openStatus, rupees, shortClock } from '@/lib/format';
import { Photo } from '@/components/ui/photo';
import { OfferBadge, RatingPill } from './bits';

function meta(card: Card): string {
  return [card.cuisines.slice(0, 2).join(' · '), `${rupees(card.costForTwoPaise)} for two`].join(' · ');
}

const STATUS_TONE = {
  open: 'bg-save-50 text-save-700',
  soon: 'bg-amber-50 text-amber-700',
  closed: 'bg-ink-100 text-ink-500',
} as const;

const OFFER_WHERE = { prebook: 'on pre-booking', walkin: 'on the bill', both: 'on pre-booking or bill' } as const;

/** "Flat 30% off on pre-booking   +1 more" — what the deal is, when it applies, and that there is more. */
function OfferStrip({ card }: { card: Card }) {
  if (!card.bestOffer) return null;
  const more = Math.max(0, (card.offerCount ?? 1) - 1);
  return (
    <p className="flex items-center justify-between gap-2 rounded-xl bg-save-600 px-2.5 py-1.5 text-[12px] font-bold text-white">
      <span className="flex min-w-0 items-center gap-1.5">
        <BadgePercent className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {card.bestOffer.label} {OFFER_WHERE[card.bestOffer.appliesTo]}
        </span>
      </span>
      {more > 0 && <span className="shrink-0 text-[11px] text-white/85">+{more} more</span>}
    </p>
  );
}

/** "Open now" · "Opens in 28 min" · "Opens at 1:00 PM" — so nobody walks up to a shut door. */
function StatusPill({ card }: { card: Card }) {
  const status = openStatus(card);
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', STATUS_TONE[status.tone])}>{status.label}</span>;
}

/**
 * The signature card: a photo with the deepest offer, and — when there are
 * tables tonight — the next three slots as one-tap chips into the booking sheet.
 */
export function RestaurantCard({ card, priority = false, className }: { card: Card; priority?: boolean; className?: string }) {
  return (
    <article
      className={cn(
        'group overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-ink-200/80 transition-shadow duration-300 hover:shadow-lift',
        className,
      )}
    >
      <Link href={`/r/${card.slug}`} className="block">
        <Photo
          src={card.coverUrl}
          alt={`${card.name}, ${card.locality}`}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          priority={priority}
          className="aspect-[16/10]"
        >
          <div className="scrim absolute inset-0" />
          {card.bestOffer && <OfferBadge label={card.bestOffer.label} className="absolute left-3 top-3" />}
          {(card.sponsored || card.isFeatured) && (
            <span className="glass absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-white">
              {card.sponsored ? 'Sponsored' : 'Tixit pick'}
            </span>
          )}
          <div className="absolute inset-x-3.5 bottom-3 text-white">
            <h3 className="text-lg font-extrabold leading-tight tracking-tight">{card.name}</h3>
            <p className="mt-0.5 line-clamp-1 text-[12.5px] text-white/80">{meta(card)}</p>
          </div>
        </Photo>
      </Link>

      <div className="flex items-center justify-between gap-2 px-3.5 pt-3 text-xs text-ink-500">
        <RatingPill rating={card.rating} count={card.ratingCount} />
        <span className="flex min-w-0 items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {card.locality}
            {card.distanceKm !== null && ` · ${distanceLabel(card.distanceKm)}`}
          </span>
        </span>
      </div>
      {!card.openNow && (
        <div className="px-3.5 pt-2">
          <StatusPill card={card} />
        </div>
      )}

      {card.nextSlots && card.nextSlots.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5 p-3">
          {card.nextSlots.map((slot) => (
            <Link
              key={slot.id}
              href={`/r/${card.slug}?book=1&slot=${slot.id}`}
              className={cn(
                'press rounded-xl py-1.5 text-center ring-1 ring-inset transition-colors',
                slot.offer ? 'bg-save-50 ring-save-100 hover:ring-save-300' : 'ring-ink-200 hover:ring-ink-300',
              )}
            >
              <span className="num block text-[13px] font-bold text-ink-900">{shortClock(slot.time)}</span>
              <span className={cn('block text-[10.5px] font-bold', slot.offer ? 'text-save-700' : 'text-ink-400')}>
                {slot.offer?.label ?? 'Book'}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="h-3" />
      )}
    </article>
  );
}

/** Narrow card for horizontal rails. */
export function RailCard({ card }: { card: Card }) {
  return (
    <Link href={`/r/${card.slug}`} className="group block w-[248px] shrink-0 snap-start sm:w-[272px]">
      <Photo src={card.coverUrl} alt={card.name} sizes="272px" className="aspect-[4/3] rounded-2xl">
        <div className="scrim absolute inset-0 opacity-60" />
        {card.bestOffer && <OfferBadge label={card.bestOffer.label} className="absolute bottom-2.5 left-2.5" />}
        {card.sponsored && (
          <span className="glass absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            Sponsored
          </span>
        )}
      </Photo>
      <div className="mt-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold text-ink-900 group-hover:text-brand-700">{card.name}</h3>
          <p className="truncate text-xs text-ink-500">{meta(card)}</p>
        </div>
        <RatingPill rating={card.rating} />
      </div>
    </Link>
  );
}

/** Search result row: dense, scannable, image left. */
export function ResultRow({ card }: { card: Card }) {
  return (
    <Link
      href={`/r/${card.slug}`}
      className="press group flex gap-3.5 rounded-3xl bg-white p-2.5 ring-1 ring-ink-200/80 transition hover:shadow-lift sm:gap-4 sm:p-3"
    >
      <Photo src={card.coverUrl} alt={card.name} sizes="160px" className="aspect-square w-28 shrink-0 rounded-2xl sm:w-36" />
      <div className="flex min-w-0 flex-1 flex-col py-0.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-base font-extrabold tracking-tight text-ink-900 group-hover:text-brand-700">{card.name}</h3>
          <RatingPill rating={card.rating} />
        </div>
        <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-500">{card.cuisines.join(', ')}</p>
        <p className="mt-0.5 text-[13px] text-ink-500">
          {card.locality}
          {card.distanceKm !== null && ` · ${distanceLabel(card.distanceKm)}`} · {rupees(card.costForTwoPaise)} for two
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          {card.sponsored && (
            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-ink-500 ring-1 ring-inset ring-ink-200">Sponsored</span>
          )}
          <StatusPill card={card} />
          {card.payBillEnabled && <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-bold text-ink-600">Pay bill</span>}
          {card.bookingEnabled && <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-bold text-ink-600">Book a table</span>}
        </div>
        {card.bestOffer && (
          <div className="pt-2">
            <OfferStrip card={card} />
          </div>
        )}
      </div>
    </Link>
  );
}

export function Rail({ title, subtitle, href, children }: { title: string; subtitle?: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="container-page flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
        </div>
        {href && (
          <Link href={href} className="shrink-0 text-sm font-bold text-brand-600 hover:text-brand-700">
            See all
          </Link>
        )}
      </div>
      <div className="container-page mt-4">
        <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:px-8">
          {children}
        </div>
      </div>
    </section>
  );
}
