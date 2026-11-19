'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarCheck2 } from 'lucide-react';
import { api, useAuth } from '@tixit/session';
import type { Reservation } from '@/lib/types';
import { localDate, timeOnly } from '@/lib/format';

/** The fastest path: if you have a table today, paying for it is one tap. */
export function TodaysTables() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['reservations', user?.id],
    queryFn: async () => (await api.get<Reservation[]>('/dining/reservations')).data,
    enabled: Boolean(user),
  });
  const today = (data ?? []).filter((r) => r.localDate === localDate() && ['placed', 'confirmed', 'seated'].includes(r.status));
  if (today.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="eyebrow text-ink-400">Your table today</h2>
      <div className="mt-2 space-y-2">
        {today.map((reservation) => (
          <Link
            key={reservation.id}
            href={`/pay/${reservation.restaurant.slug}`}
            className="press flex items-center gap-4 rounded-3xl bg-ink-900 p-4 text-white"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10">
              <CalendarCheck2 className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{reservation.restaurant.name}</span>
              <span className="block text-sm text-ink-300">
                {timeOnly(reservation.startsAt)} · {reservation.partySize} guests
                {reservation.offer ? ` · ${reservation.offer.headline} locked in` : ''}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-sm font-bold">
              Pay <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
