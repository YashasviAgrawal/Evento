'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarX2, ChevronRight, ReceiptText } from 'lucide-react';
import { api, useAuth } from '@tixit/session';
import type { Bill, Reservation } from '@/lib/types';
import { cn, dateTime, relativeDay, rupees, timeOnly } from '@/lib/format';
import { Photo } from '@/components/ui/photo';
import { EmptyState, Skeleton } from '@/components/ui/feedback';

const LIVE = ['placed', 'confirmed', 'seated'];

export const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  placed: { text: 'Awaiting confirmation', tone: 'bg-amber-50 text-amber-700' },
  confirmed: { text: 'Confirmed', tone: 'bg-save-50 text-save-700' },
  seated: { text: 'Seated', tone: 'bg-save-50 text-save-700' },
  completed: { text: 'Completed', tone: 'bg-ink-100 text-ink-600' },
  cancelled_by_diner: { text: 'Cancelled', tone: 'bg-ink-100 text-ink-500' },
  cancelled_by_restaurant: { text: 'Declined by restaurant', tone: 'bg-rose-50 text-rose-700' },
  no_show: { text: 'Missed', tone: 'bg-rose-50 text-rose-700' },
  expired: { text: 'Expired', tone: 'bg-ink-100 text-ink-500' },
};

export function Plans() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'upcoming' | 'past' | 'payments'>('upcoming');
  const reservations = useQuery({
    queryKey: ['reservations', user?.id],
    queryFn: async () => (await api.get<Reservation[]>('/dining/reservations')).data,
  });
  const bills = useQuery({
    queryKey: ['bills', user?.id],
    queryFn: async () => (await api.get<Bill[]>('/dining/bills')).data,
  });

  const cutoff = Date.now() - 3 * 3600_000;
  const upcoming = (reservations.data ?? []).filter((r) => LIVE.includes(r.status) && new Date(r.startsAt).getTime() > cutoff);
  const past = (reservations.data ?? []).filter((r) => !upcoming.includes(r));
  const liveBill = (bills.data ?? []).find((b) => b.status === 'paid');

  return (
    <>
      {liveBill && (
        <Link
          href={`/bills/${liveBill.code}`}
          className="night press mt-5 flex items-center gap-4 rounded-3xl p-4"
        >
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-600">
            <ReceiptText className="h-6 w-6" />
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full bg-save-400 ring-2 ring-ink-950" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">Show your pass to the staff</span>
            <span className="block truncate text-sm text-ink-300">
              {rupees(liveBill.amountPaidPaise)} paid at {liveBill.restaurant.name}
            </span>
          </span>
          <ChevronRight className="h-5 w-5 text-ink-400" />
        </Link>
      )}

      <div className="mt-5 inline-flex rounded-full bg-ink-100 p-1 text-sm font-bold" role="tablist">
        {(
          [
            ['upcoming', `Upcoming${upcoming.length ? ` · ${upcoming.length}` : ''}`],
            ['past', 'Past'],
            ['payments', 'Payments'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn('rounded-full px-4 py-2 transition', tab === value ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {(tab === 'payments' ? bills.isLoading : reservations.isLoading) ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 rounded-3xl" />
            ))}
          </div>
        ) : tab === 'payments' ? (
          (bills.data ?? []).length === 0 ? (
            <EmptyState icon={ReceiptText} title="No payments yet" body="Pay your next restaurant bill on Tixit and your savings will show up here." action={<CTA href="/pay" label="Pay a bill" />} />
          ) : (
            <ul className="space-y-2.5">
              {bills.data!.map((bill) => (
                <li key={bill.id}>
                  <Link href={`/bills/${bill.code}`} className="press flex items-center gap-3.5 rounded-3xl bg-white p-3 ring-1 ring-ink-200 hover:shadow-lift">
                    <Photo src={bill.restaurant.coverUrl} alt="" sizes="56px" className="h-14 w-14 shrink-0 rounded-2xl" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{bill.restaurant.name}</span>
                      <span className="block text-xs text-ink-500">{bill.paidAt ? dateTime(bill.paidAt) : dateTime(bill.createdAt)}</span>
                    </span>
                    <span className="text-right">
                      <span className="num block font-bold">{rupees(bill.amountPaidPaise)}</span>
                      {bill.pricing.totalDiscountPaise > 0 && (
                        <span className="num block text-xs font-bold text-save-700">saved {rupees(bill.pricing.totalDiscountPaise)}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : (tab === 'upcoming' ? upcoming : past).length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title={tab === 'upcoming' ? 'No tables booked' : 'Nothing here yet'}
            body={tab === 'upcoming' ? 'Find a place and lock in a pre-book offer for tonight.' : 'Your past visits will appear here.'}
            action={tab === 'upcoming' ? <CTA href="/restaurants?openNow=1" label="Find a table" /> : undefined}
          />
        ) : (
          <ul className="space-y-3">
            {(tab === 'upcoming' ? upcoming : past).map((reservation) => (
              <li key={reservation.id}>
                <ReservationCard reservation={reservation} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function CTA({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="press inline-flex h-11 items-center rounded-2xl bg-ink-900 px-5 text-sm font-bold text-white">
      {label}
    </Link>
  );
}

function ReservationCard({ reservation }: { reservation: Reservation }) {
  const status = STATUS_LABEL[reservation.status] ?? { text: reservation.status, tone: 'bg-ink-100 text-ink-600' };
  return (
    <Link href={`/bookings/${reservation.code}`} className="press block overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200 hover:shadow-lift">
      <div className="flex gap-3.5 p-3">
        <Photo src={reservation.restaurant.coverUrl} alt="" sizes="80px" className="h-20 w-20 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1 py-0.5">
          <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-bold', status.tone)}>{status.text}</span>
          <p className="mt-1 truncate font-bold">{reservation.restaurant.name}</p>
          <p className="text-sm text-ink-500">
            {relativeDay(reservation.startsAt)} · {timeOnly(reservation.startsAt)} · {reservation.partySize} guests
          </p>
        </div>
        <ChevronRight className="mt-7 h-5 w-5 shrink-0 text-ink-300" />
      </div>
      {reservation.offer && LIVE.includes(reservation.status) && (
        <div className="border-t border-dashed border-ink-200 bg-save-50/60 px-4 py-2 text-xs font-bold text-save-700">
          {reservation.offer.headline} locked in — applies when you pay on Tixit
        </div>
      )}
    </Link>
  );
}
