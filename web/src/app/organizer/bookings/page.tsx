'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download, Search, TicketX } from 'lucide-react';
import { api, downloadFile, type PageMeta } from '@/lib/api';
import type { EventCard } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { EmptyState, Input, Select, Skeleton, StatusBadge } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';

interface OrganizerBooking {
  id: string;
  bookingCode: string;
  status: string;
  quantity: number;
  totalPaise: number;
  payoutPaise: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  createdAt: string;
  confirmedAt: string | null;
  checkedIn: number;
  event: { id: string; title: string };
}

export default function OrganizerBookingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <BookingsTable />
    </Suspense>
  );
}

function BookingsTable() {
  const searchParams = useSearchParams();
  const toast = useToast();

  const [eventId, setEventId] = useState(searchParams.get('eventId') ?? '');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [events, setEvents] = useState<EventCard[]>([]);
  const [bookings, setBookings] = useState<OrganizerBooking[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    api
      .get<EventCard[]>('/organizer/events', { query: { limit: 50 } })
      .then((response) => setEvents(response.data))
      .catch(() => setEvents([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<OrganizerBooking[]>('/organizer/bookings', {
        query: {
          eventId: eventId || undefined,
          status: status || undefined,
          q: debounced || undefined,
          page,
          limit: 20,
        },
      });
      setBookings(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [eventId, status, debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadFile(
        `/organizer/bookings/export${eventId ? `?eventId=${eventId}` : ''}`,
        `evento-attendees-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      toast.success('Export downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Bookings"
        description="Every attendee across your events"
        actions={
          <Button variant="outline" onClick={exportCsv} loading={exporting}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or booking ID"
            className="pl-9"
            aria-label="Search bookings"
          />
        </div>

        <Select
          value={eventId}
          onChange={(e) => {
            setEventId(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by event"
        >
          <option value="">All events</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title}
            </option>
          ))}
        </Select>

        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
          <option value="expired">Expired</option>
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={<TicketX className="h-9 w-9" />}
          title="No bookings found"
          description="Once customers start booking, they'll show up here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Booking</th>
                  <th className="px-5 py-3 font-semibold">Customer</th>
                  <th className="px-5 py-3 font-semibold">Event</th>
                  <th className="px-5 py-3 text-right font-semibold">Qty</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                  <th className="px-5 py-3 text-right font-semibold">Your payout</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {bookings.map((booking) => (
                  <tr key={booking.id} className="transition hover:bg-ink-50">
                    <td className="px-5 py-3.5">
                      <p className="font-mono text-xs font-semibold text-ink-900">{booking.bookingCode}</p>
                      <p className="mt-0.5 text-xs text-ink-500">{formatDateTime(booking.createdAt)}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-ink-900">{booking.customerName}</p>
                      <p className="mt-0.5 text-xs text-ink-500">{booking.customerEmail}</p>
                    </td>
                    <td className="max-w-[16rem] px-5 py-3.5">
                      <p className="truncate text-ink-700">{booking.event.title}</p>
                      {booking.checkedIn > 0 && (
                        <p className="mt-0.5 text-xs font-medium text-emerald-600">
                          {booking.checkedIn} checked in
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">
                      {formatNumber(booking.quantity)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-ink-900">
                      {formatMoney(booking.totalPaise)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-emerald-700">
                      {formatMoney(booking.payoutPaise)}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={booking.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-ink-200 px-5 py-3">
              <p className="text-xs text-ink-500">
                {formatNumber(meta.total)} bookings · page {meta.page} of {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
