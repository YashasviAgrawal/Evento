'use client';

import { useEffect, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { api } from '@/lib/api';
import { dineinUrl, type DineinCard as Card } from '@/lib/dinein';
import { DineinCard } from './dinein-card';

/** "Eat nearby before the show" — the closest Tixit restaurants to the venue. */
export function NearbyDining({ lat, lng, city }: { lat: number; lng: number; city: string }) {
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Card[]>('/dining/restaurants', { query: { lat, lng, sort: 'distance', limit: 4 }, auth: false })
      .then(({ data }) => !cancelled && setCards(data.filter((card) => card.distanceKm === null || card.distanceKm <= 15)))
      .catch(() => !cancelled && setCards([]));
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  if (!cards || cards.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink-900">
          <UtensilsCrossed className="h-5 w-5 text-brand-600" /> Eat nearby before the show
        </h2>
        <a href={dineinUrl(`/restaurants?lat=${lat}&lng=${lng}&sort=distance`)} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          More in {city}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((card) => (
          <DineinCard key={card.id} card={card} compact />
        ))}
      </div>
    </section>
  );
}
