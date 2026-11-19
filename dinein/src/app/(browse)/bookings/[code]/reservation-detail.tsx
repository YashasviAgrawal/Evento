'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Navigation, Phone, ReceiptText, Wallet } from 'lucide-react';
import { PAYMENT_CANCELLED, api } from '@tixit/session';
import { payDeposit } from '@/lib/deposit';
import { useToast } from '@tixit/ui';
import type { Reservation } from '@/lib/types';
import { cn, dateTime, localDate, rupees } from '@/lib/format';
import { directionsUrl } from '@/lib/urls';
import { Photo } from '@/components/ui/photo';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/feedback';
import { STATUS_LABEL } from '../plans';

const TIMELINE = [
  { key: 'placed', label: 'Requested' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'seated', label: 'Seated' },
  { key: 'completed', label: 'Paid & done' },
];

export function ReservationDetail({ code }: { code: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { data: reservation, isLoading } = useQuery({
    queryKey: ['reservation', code],
    queryFn: async () => (await api.get<Reservation>(`/dining/reservations/${code}`)).data,
    refetchInterval: (query) => (query.state.data?.status === 'placed' ? 10_000 : false),
  });

  const cancel = useMutation({
    mutationFn: async () => (await api.post<Reservation>(`/dining/reservations/${code}/cancel`, {})).data,
    onSuccess: (updated) => {
      queryClient.setQueryData(['reservation', code], updated);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      setConfirmCancel(false);
      toast.success('Booking cancelled', 'The table has been released.');
    },
    onError: (error) => toast.error('Could not cancel', error instanceof Error ? error.message : undefined),
  });

  const depositPay = useMutation({
    mutationFn: () => payDeposit(code),
    onSuccess: (updated) => {
      queryClient.setQueryData(['reservation', code], updated);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      toast.success('Deposit paid — your table is booked');
    },
    onError: (error) => {
      if (error instanceof Error && error.message === PAYMENT_CANCELLED) return;
      toast.error('Deposit not paid', error instanceof Error ? error.message : undefined);
    },
  });

  if (isLoading || !reservation) return <Skeleton className="mt-6 h-96 rounded-3xl" />;

  const status = STATUS_LABEL[reservation.status]!;
  const live = ['pending_payment', 'placed', 'confirmed', 'seated'].includes(reservation.status);
  const deposit = reservation.deposit;
  const holdMinutes = deposit?.holdExpiresAt ? Math.max(0, Math.ceil((new Date(deposit.holdExpiresAt).getTime() - Date.now()) / 60_000)) : 0;
  const DEPOSIT_COPY: Record<string, string> = {
    pending: `Pay within ${holdMinutes} min to keep this table.`,
    paid: 'Held safely — credited to your bill when you pay on Tixit.',
    credited: 'Credited to your bill.',
    refunded: 'Refunded to your original payment method (5–7 working days).',
    forfeited: 'Kept by the restaurant under the late-cancellation policy.',
  };
  const isToday = reservation.localDate === localDate();
  const step = TIMELINE.findIndex((item) => item.key === reservation.status);

  return (
    <div className="mt-4">
      <Link href="/bookings" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Your plans
      </Link>

      <div className="mt-4 overflow-hidden rounded-[28px] bg-white shadow-lift ring-1 ring-ink-200">
        <Photo src={reservation.restaurant.coverUrl} alt="" sizes="(max-width: 672px) 100vw, 672px" className="aspect-[16/7]">
          <div className="scrim absolute inset-0" />
          <div className="absolute inset-x-5 bottom-4 text-white">
            <span className={cn('inline-block rounded-full px-2.5 py-1 text-[11px] font-bold', status.tone)}>{status.text}</span>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{reservation.restaurant.name}</h1>
            <p className="text-sm text-white/80">{reservation.restaurant.locality}</p>
          </div>
        </Photo>
        <div className="grid grid-cols-2 gap-4 p-5">
          <div>
            <p className="eyebrow text-ink-400">When</p>
            <p className="mt-0.5 font-bold">{dateTime(reservation.startsAt)}</p>
          </div>
          <div>
            <p className="eyebrow text-ink-400">Guests</p>
            <p className="mt-0.5 font-bold">
              {reservation.partySize}
              {reservation.occasion ? ` · ${reservation.occasion}` : ''}
            </p>
          </div>
        </div>
        <div className="perforation" aria-hidden>
          <i />
        </div>
        <div className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="eyebrow text-ink-400">Booking code</p>
            <p className="num text-xl font-black tracking-[0.12em]">{reservation.code}</p>
          </div>
          {reservation.offer && (
            <div className="rounded-2xl bg-save-600 px-3.5 py-2 text-right text-white">
              <p className="text-[10px] font-bold uppercase tracking-wider text-save-100">{live ? 'Locked in' : 'Offer'}</p>
              <p className="font-extrabold">{reservation.offer.headline}</p>
            </div>
          )}
        </div>
      </div>

      {live && (
        <ol className="mt-5 flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-ink-200">
          {TIMELINE.map((item, index) => (
            <li key={item.key} className="flex flex-1 items-center gap-2 last:flex-none">
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', index <= step ? 'bg-save-500' : 'bg-ink-200')} />
              <span className={cn('text-xs font-semibold', index <= step ? 'text-ink-900' : 'text-ink-400')}>{item.label}</span>
              {index < TIMELINE.length - 1 && <span className={cn('mx-2 h-px flex-1', index < step ? 'bg-save-300' : 'bg-ink-200')} />}
            </li>
          ))}
        </ol>
      )}

      {deposit && (
        <div
          className={cn(
            'mt-4 flex items-center gap-3 rounded-2xl p-4 ring-1 ring-inset',
            deposit.status === 'pending' ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-ink-200',
          )}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white ring-1 ring-ink-200">
            <Wallet className="h-5 w-5 text-ink-500" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Table deposit · {rupees(deposit.amountPaise)}</p>
            <p className="text-xs text-ink-600">{DEPOSIT_COPY[deposit.status]}</p>
          </div>
          {deposit.status === 'pending' && reservation.status === 'pending_payment' && (
            <button
              onClick={() => depositPay.mutate()}
              disabled={depositPay.isPending}
              className="press h-10 shrink-0 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white shadow-glow disabled:opacity-60"
            >
              {depositPay.isPending ? 'Paying…' : 'Pay now'}
            </button>
          )}
        </div>
      )}

      {live && isToday && reservation.status !== 'pending_payment' && (
        <Link
          href={`/pay/${reservation.restaurant.slug}`}
          className="press mt-4 flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand-600 font-bold text-white shadow-glow"
        >
          <ReceiptText className="h-5 w-5" /> Pay the bill {reservation.offer ? `· ${reservation.offer.headline}` : ''}
        </Link>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href={directionsUrl(reservation.restaurant.lat, reservation.restaurant.lng, reservation.restaurant.name)}
          target="_blank"
          rel="noreferrer"
          className="press flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-bold ring-1 ring-inset ring-ink-200"
        >
          <Navigation className="h-4 w-4" /> Directions
        </a>
        {reservation.restaurant.phone ? (
          <a
            href={`tel:${reservation.restaurant.phone.replace(/\s/g, '')}`}
            className="press flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-bold ring-1 ring-inset ring-ink-200"
          >
            <Phone className="h-4 w-4" /> Call restaurant
          </a>
        ) : (
          <Link
            href={`/r/${reservation.restaurant.slug}`}
            className="press flex h-12 items-center justify-center rounded-2xl bg-white text-sm font-bold ring-1 ring-inset ring-ink-200"
          >
            View restaurant
          </Link>
        )}
      </div>

      {reservation.canCancel && (
        <button onClick={() => setConfirmCancel(true)} className="mt-6 w-full text-center text-sm font-bold text-rose-600 hover:text-rose-700">
          Cancel this booking
        </button>
      )}

      <Sheet
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel your table?"
        subtitle={`${reservation.restaurant.name} · ${dateTime(reservation.startsAt)}`}
        footer={
          <div className="flex gap-2 pb-1">
            <button onClick={() => setConfirmCancel(false)} className="press h-12 flex-1 rounded-2xl font-bold ring-1 ring-inset ring-ink-300">
              Keep it
            </button>
            <button
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
              className="press h-12 flex-1 rounded-2xl bg-rose-600 font-bold text-white disabled:opacity-60"
            >
              {cancel.isPending ? 'Cancelling…' : 'Yes, cancel'}
            </button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          The table goes back to the restaurant straight away
          {reservation.offer ? `, and the ${reservation.offer.headline} you locked in won’t be held` : ''}.{' '}
          {deposit?.status === 'paid'
            ? deposit.refundableNow
              ? `Your ${rupees(deposit.amountPaise)} deposit will be refunded in full.`
              : `It’s less than 24 hours to your table, so the restaurant keeps the ${rupees(deposit.amountPaise)} deposit.`
            : 'It’s free to cancel.'}
        </p>
      </Sheet>
    </div>
  );
}
