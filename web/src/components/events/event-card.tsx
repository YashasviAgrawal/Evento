import Image from 'next/image';
import Link from 'next/link';
import { Calendar, MapPin, Sparkles } from 'lucide-react';
import type { EventCard as EventCardType } from '@/lib/types';
import { cn, formatEventTime, friendlyDate, priceLabel } from '@/lib/format';

const FALLBACK_IMAGE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDUwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iI2UyZThmMCIvPjwvc3ZnPg==';

export function EventCard({ event, priority = false }: { event: EventCardType; priority?: boolean }) {
  return (
    <Link
      href={`/events/${event.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card transition-all duration-300 ease-smooth hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift active:translate-y-0 active:scale-[0.99]"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-ink-100">
        <Image
          src={event.thumbnailUrl || event.bannerUrl || FALLBACK_IMAGE}
          alt={`${event.title} — ${event.venue.name}, ${event.city.name}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          priority={priority}
          // A tiny blurred stand-in means the card never flashes an empty grey
          // box — the image resolves into place instead of popping in.
          placeholder="blur"
          blurDataURL={FALLBACK_IMAGE}
          className="object-cover transition-transform duration-500 ease-smooth group-hover:scale-105"
        />

        <div className="absolute left-3 top-3 flex gap-1.5">
          <span
            className="badge bg-white/95 text-ink-800 ring-white/40 backdrop-blur"
            style={{ color: event.category.color }}
          >
            {event.category.name}
          </span>
          {event.isFeatured && (
            <span className="badge bg-brand-600 text-white ring-brand-500">
              <Sparkles className="h-3 w-3" aria-hidden />
              Featured
            </span>
          )}
        </div>

        {event.soldOut && (
          <div className="absolute inset-0 grid place-items-center bg-ink-950/60">
            <span className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-ink-900">
              Sold out
            </span>
          </div>
        )}

        {/* Nudge urgency only when it is truthful. */}
        {!event.soldOut && event.totalCapacity > 0 && event.ticketsAvailable <= event.totalCapacity * 0.1 && (
          <span className="absolute bottom-3 left-3 badge bg-rose-600 text-white ring-rose-500">
            Only {event.ticketsAvailable} left
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-600">
          <Calendar className="h-3.5 w-3.5" aria-hidden />
          {friendlyDate(event.startsAt)} · {formatEventTime(event.startsAt)}
        </p>

        <h3 className="mt-2 line-clamp-2 text-base font-bold leading-snug text-ink-900 group-hover:text-brand-700">
          {event.title}
        </h3>

        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {event.venue.name}, {event.city.name}
          </span>
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-4">
          <span
            className={cn(
              'text-sm font-bold',
              event.isFree || event.maxPricePaise === 0 ? 'text-emerald-600' : 'text-ink-900',
            )}
          >
            {priceLabel(event.minPricePaise, event.maxPricePaise, event.isFree)}
          </span>
          <span className="text-xs font-medium text-ink-400 transition group-hover:text-brand-600">Book now →</span>
        </div>
      </div>
    </Link>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div className="skeleton aspect-[16/10]" />
      <div className="space-y-2.5 p-4">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}
