'use client';

import { use, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX2 } from 'lucide-react';
import { api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { Reservation } from '@/lib/types';
import { addDays, cn, dayPill, localDate, timeOnly } from '@/lib/format';
import { PageHeading } from '@/components/partner/partner-shell';
import { EmptyState, Skeleton } from '@/components/ui/feedback';

const ACTIONS: Record<string, Array<{ action: string; label: string; tone: string }>> = {
  placed: [
    { action: 'accept', label: 'Accept', tone: 'bg-save-600 text-white' },
    { action: 'decline', label: 'Decline', tone: 'ring-1 ring-inset ring-ink-300' },
  ],
  confirmed: [
    { action: 'seat', label: 'Seat', tone: 'bg-ink-900 text-white' },
    { action: 'no_show', label: 'No-show', tone: 'ring-1 ring-inset ring-ink-300' },
  ],
  seated: [{ action: 'complete', label: 'Complete', tone: 'bg-ink-900 text-white' }],
};

const STATUS_TONE: Record<string, string> = {
  placed: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-save-50 text-save-700',
  seated: 'bg-sky-50 text-sky-700',
  completed: 'bg-ink-100 text-ink-600',
  no_show: 'bg-rose-50 text-rose-700',
  cancelled_by_diner: 'bg-ink-100 text-ink-500',
  cancelled_by_restaurant: 'bg-ink-100 text-ink-500',
};

export default function PartnerReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = localDate();
  const [date, setDate] = useState(today);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);

  const list = useQuery({
    queryKey: ['partner-reservations', id, date],
    queryFn: async () => (await api.get<Reservation[]>(`/partner/r/${id}/reservations`, { query: { date } })).data,
    refetchInterval: 15_000,
  });

  const act = useMutation({
    mutationFn: async ({ code, action }: { code: string; action: string }) =>
      (await api.post<Reservation>(`/partner/r/${id}/reservations/${code}/${action}`, {})).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['partner-reservations', id] });
      void queryClient.invalidateQueries({ queryKey: ['partner-live', id] });
    },
    onError: (error) => toast.error('Could not update', error instanceof Error ? error.message : undefined),
  });

  const rows = list.data ?? [];
  const covers = rows.filter((r) => ['placed', 'confirmed', 'seated', 'completed'].includes(r.status)).reduce((sum, r) => sum + r.partySize, 0);

  return (
    <>
      <PageHeading title="Reservations" subtitle={`${rows.length} bookings · ${covers} covers`} />
      <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto px-4 sm:px-8">
        {days.map((day) => {
          const pill = dayPill(day, today);
          return (
            <button
              key={day}
              onClick={() => setDate(day)}
              className={cn(
                'press w-14 shrink-0 rounded-2xl py-2 text-center',
                day === date ? 'bg-ink-900 text-white' : 'bg-white ring-1 ring-inset ring-ink-200',
              )}
            >
              <span className="block text-[10.5px] font-bold uppercase opacity-70">{pill.top}</span>
              <span className="num block text-lg font-extrabold">{pill.day}</span>
            </button>
          );
        })}
      </div>

      <div className="px-4 pb-10 pt-5 sm:px-8">
        {list.isLoading ? (
          <Skeleton className="h-64 rounded-3xl" />
        ) : rows.length === 0 ? (
          <EmptyState icon={CalendarX2} title="No bookings for this day" body="Bookings appear here the moment a diner confirms on Tixit." />
        ) : (
          <ul className="divide-y divide-ink-100 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
            {rows.map((reservation) => (
              <li key={reservation.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="num w-[76px] text-base font-extrabold">{timeOnly(reservation.startsAt)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {reservation.guestName} · {reservation.partySize} {reservation.partySize === 1 ? 'guest' : 'guests'}
                  </span>
                  <span className="block text-xs text-ink-500">
                    {reservation.code}
                    {reservation.occasion ? ` · ${reservation.occasion}` : ''}
                    {reservation.offer ? ` · ${reservation.offer.headline} promised` : ''}
                  </span>
                  {reservation.notes && <span className="mt-1 block rounded-lg bg-ink-50 px-2 py-1 text-xs text-ink-600">“{reservation.notes}”</span>}
                </span>
                <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold capitalize', STATUS_TONE[reservation.status] ?? 'bg-ink-100')}>
                  {reservation.status.replace(/_/g, ' ').replace('by diner', '').replace('by restaurant', '(declined)')}
                </span>
                <span className="flex gap-1.5">
                  {(ACTIONS[reservation.status] ?? []).map((item) => (
                    <button
                      key={item.action}
                      onClick={() => act.mutate({ code: reservation.code, action: item.action })}
                      disabled={act.isPending}
                      className={cn('press h-9 rounded-xl px-3.5 text-xs font-bold disabled:opacity-60', item.tone)}
                    >
                      {item.label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
