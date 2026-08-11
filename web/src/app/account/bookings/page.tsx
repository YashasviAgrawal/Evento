'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CalendarDays, MapPin, TicketX } from 'lucide-react';
import { api, type PageMeta } from '@/lib/api';
import type { BookingSummary } from '@/lib/types';
import { RequireAuth } from '@/components/auth/require-auth';
import { ButtonLink, Button } from '@/components/ui/button';
import { EmptyState, Skeleton, StatusBadge } from '@/components/ui/index';
import { cn, formatEventDateTime, formatMoney, isEventPast } from '@/lib/format';

const SCOPES = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
] as const;

export default function BookingsPage() {
  return (
    <RequireAuth>
      <BookingsList />
    </RequireAuth>
  );
}

function BookingsList() {
  const [scope, setScope] = useState<(typeof SCOPES)[number]['key']>('upcoming');
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<BookingSummary[]>('/bookings', { query: { scope, page, limit: 10 } });
      setBookings(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [scope, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="container-page py-8 lg:py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">My bookings</h1>
        <p className="mt-1 text-sm text-ink-500">Your tickets, receipts and booking history</p>
      </div>

      <div className="mb-6 inline-flex gap-1 rounded-lg bg-ink-100 p-1">
        {SCOPES.map((entry) => (
          <button
            key={entry.key}
            onClick={() => {
              setScope(entry.key);
              setPage(1);
            }}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition',
              scope === entry.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={<TicketX className="h-10 w-10" />}
          title={scope === 'upcoming' ? 'No upcoming bookings' : 'Nothing here yet'}
          description="When you book an event, your tickets will appear here with a scannable QR code."
          action={<ButtonLink href="/events">Discover events</ButtonLink>}
        />
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <Link
              key={booking.id}
              href={`/account/bookings/${booking.id}`}
              className="group flex flex-col gap-4 rounded-xl border border-ink-200 bg-white p-4 shadow-card transition hover:shadow-lift sm:flex-row"
            >
              <div className="relative h-32 w-full shrink-0 overflow-hidden rounded-lg bg-ink-100 sm:h-24 sm:w-40">
                {booking.event.thumbnailUrl && (
                  <Image
                    src={booking.event.thumbnailUrl}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, 160px"
                    className="object-cover"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-base font-bold text-ink-900 group-hover:text-brand-700">
                    {booking.event.title}
                  </h2>
                  <StatusBadge status={booking.status} />
                </div>

                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-500">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {formatEventDateTime(booking.event.startsAt)}
                  {isEventPast(booking.event.startsAt) && <span className="text-ink-400">· Past</span>}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    {booking.event.venueName}, {booking.event.cityName}
                  </span>
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                  <span className="font-mono font-semibold text-ink-700">{booking.bookingCode}</span>
                  <span>
                    {booking.quantity} {booking.quantity === 1 ? 'ticket' : 'tickets'}
                  </span>
                  <span className="font-semibold text-ink-900">{formatMoney(booking.totalPaise)}</span>
                  {booking.status === 'confirmed' && booking.validTickets > 0 && (
                    <span className="font-medium text-emerald-600">{booking.validTickets} valid</span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center">
                <span className="text-sm font-medium text-brand-600">View ticket →</span>
              </div>
            </Link>
          ))}

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-ink-500">
                Page {meta.page} of {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!meta.hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
