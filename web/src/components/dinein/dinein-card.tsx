import { MapPin, Star, Tag } from 'lucide-react';
import { dineinUrl, type DineinCard as Card } from '@/lib/dinein';
import { Photo } from '@/components/ui/photo';
import { cn } from '@/lib/format';

/** A restaurant card that opens on dinein.tixit.in, already signed in. */
export function DineinCard({ card, compact = false }: { card: Card; compact?: boolean }) {
  return (
    <a
      href={dineinUrl(`/r/${card.slug}`)}
      className={cn(
        'group block shrink-0 snap-start overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200 transition hover:-translate-y-0.5 hover:shadow-lift',
        compact ? 'w-full' : 'w-[260px]',
      )}
    >
      <Photo
        src={card.coverUrl}
        alt=""
        sizes="260px"
        className="aspect-[4/3]"
        imageClassName="group-hover:scale-105"
      >
        {card.bestOffer && (
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-extrabold text-emerald-700 shadow-card">
            <Tag className="h-3 w-3" /> {card.bestOffer.label}
          </span>
        )}
      </Photo>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-bold text-ink-900 group-hover:text-brand-700">{card.name}</h3>
          {card.rating > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[11px] font-extrabold text-white">
              {card.rating.toFixed(1)} <Star className="h-2.5 w-2.5 fill-white stroke-none" />
            </span>
          )}
        </div>
        <p className="truncate text-xs text-ink-500">{card.cuisines.slice(0, 2).join(' · ')}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-ink-500">
          <MapPin className="h-3 w-3" /> {card.locality}
          {card.distanceKm !== null && ` · ${card.distanceKm} km`}
        </p>
      </div>
    </a>
  );
}
