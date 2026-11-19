'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, BellOff, Check, ChevronRight, Users, X } from 'lucide-react';
import { api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { PartnerBill, PartnerLive, Reservation } from '@/lib/types';
import { ago, cn, plural, rupees, timeOnly } from '@/lib/format';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/feedback';
import { useLive } from './use-partner';
import { PageHeading } from './partner-shell';

/** A short two-note chime — enough to hear over a busy floor, never jarring. */
function chime() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.14 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.14);
      osc.stop(ctx.currentTime + i * 0.14 + 0.4);
    });
  } catch {
    // Audio is a nicety; browsers may block it until the first tap.
  }
}

export function LiveBoard({ restaurantId }: { restaurantId: string }) {
  const { data, isLoading } = useLive(restaurantId);
  const [sound, setSound] = useState(true);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Chime and highlight payments that arrived since the last poll.
  useEffect(() => {
    if (!data) return;
    const codes = data.bills.filter((b) => b.status === 'paid').map((b) => b.code);
    if (seen.current === null) {
      seen.current = new Set(data.bills.map((b) => b.code));
      return;
    }
    const arrivals = codes.filter((code) => !seen.current!.has(code));
    data.bills.forEach((b) => seen.current!.add(b.code));
    if (arrivals.length) {
      if (sound) chime();
      setFresh((current) => new Set([...current, ...arrivals]));
    }
  }, [data, sound]);

  if (isLoading || !data) {
    return (
      <div className="space-y-3 p-4 sm:p-8">
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-24 rounded-3xl" />
      </div>
    );
  }

  const toVerify = data.bills.filter((b) => b.status === 'paid');
  const done = data.bills.filter((b) => b.status !== 'paid');
  const upcoming = data.reservations.filter((r) => ['placed', 'confirmed', 'seated'].includes(r.status));

  return (
    <>
      <PageHeading
        title="Live"
        subtitle="Payments and arrivals as they happen"
        action={
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-save-50 px-3 py-1.5 text-xs font-bold text-save-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-save-400 opacity-75" />
                <span className="relative h-2 w-2 rounded-full bg-save-500" />
              </span>
              Connected
            </span>
            <button
              onClick={() => setSound((value) => !value)}
              className="press grid h-8 w-8 place-items-center rounded-full bg-white ring-1 ring-ink-200"
              aria-label={sound ? 'Mute payment chime' : 'Unmute payment chime'}
            >
              {sound ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4 text-ink-400" />}
            </button>
          </div>
        }
      />

      <div className="grid gap-6 px-4 pb-10 pt-5 sm:px-8 lg:grid-cols-[1.35fr_1fr]">
        <section>
          <h2 className="eyebrow text-ink-400">To verify · {toVerify.length}</h2>
          {toVerify.length === 0 ? (
            <div className="mt-2 rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-10 text-center">
              <p className="font-bold">All caught up</p>
              <p className="mt-1 text-sm text-ink-500">New Tixit payments appear here with a chime.</p>
            </div>
          ) : (
            <ul className="mt-2 space-y-3">
              {toVerify.map((bill) => (
                <li key={bill.code}>
                  <VerifyCard bill={bill} restaurantId={restaurantId} fresh={fresh.has(bill.code)} now={now} />
                </li>
              ))}
            </ul>
          )}

          {done.length > 0 && (
            <>
              <h2 className="eyebrow mt-8 text-ink-400">Earlier today</h2>
              <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
                {done.map((bill) => (
                  <li key={bill.code} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="num w-20 font-bold">{rupees(bill.amountPaidPaise)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-500">
                      Bill {rupees(bill.billTotalPaise)} · {bill.dinerName} {bill.phoneLast4 ? `· ••${bill.phoneLast4}` : ''} · {bill.paidAt ? timeOnly(bill.paidAt) : ''}
                    </span>
                    {bill.status === 'disputed' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600">
                        <AlertTriangle className="h-3.5 w-3.5" /> Disputed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-save-700">
                        <Check className="h-3.5 w-3.5" /> {bill.verificationMethod === 'auto' ? 'Auto-verified' : 'Verified'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="space-y-3">
          <Summary summary={data.summary} />
          <div className="rounded-3xl bg-white p-4 ring-1 ring-ink-200">
            <div className="flex items-center justify-between">
              <h2 className="eyebrow text-ink-400">Next arrivals</h2>
              <Link href={`/partner/${restaurantId}/reservations`} className="text-xs font-bold text-brand-600">
                All
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-500">No more tables booked today.</p>
            ) : (
              <ul className="mt-1 divide-y divide-ink-100">
                {upcoming.slice(0, 8).map((reservation) => (
                  <ArrivalRow key={reservation.id} reservation={reservation} restaurantId={restaurantId} />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Summary({ summary }: { summary: PartnerLive['summary'] }) {
  const tiles = [
    { label: 'Tixit sales today', value: rupees(summary.grossSalesPaise), sub: plural(summary.billsPaid, 'bill') },
    { label: 'Your payout', value: rupees(summary.payoutEarnedPaise), sub: 'after commission' },
    { label: 'Covers booked', value: String(summary.covers), sub: plural(summary.tables, 'table') },
    { label: 'Requests', value: String(summary.pendingRequests), sub: 'awaiting you', warn: summary.pendingRequests > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((tile) => (
        <div key={tile.label} className={cn('rounded-3xl bg-white p-4 ring-1', tile.warn ? 'ring-amber-300' : 'ring-ink-200')}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{tile.label}</p>
          <p className="num mt-1 text-2xl font-black tracking-tight">{tile.value}</p>
          <p className={cn('text-xs font-semibold', tile.warn ? 'text-amber-600' : 'text-ink-500')}>{tile.sub}</p>
        </div>
      ))}
    </div>
  );
}

function VerifyCard({ bill, restaurantId, fresh, now }: { bill: PartnerBill; restaurantId: string; fresh: boolean; now: number }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mismatchOpen, setMismatchOpen] = useState(false);
  const [reason, setReason] = useState('');

  const verify = useMutation({
    mutationFn: async (input: { result: 'match' | 'mismatch'; reason?: string }) =>
      (await api.post<PartnerBill>(`/partner/r/${restaurantId}/bills/${bill.code}/verify`, input)).data,
    onSuccess: (_, input) => {
      setMismatchOpen(false);
      toast.success(input.result === 'match' ? 'Payment verified' : 'Flagged for review', `${rupees(bill.amountPaidPaise)} · ${bill.code}`);
      void queryClient.invalidateQueries({ queryKey: ['partner-live', restaurantId] });
    },
    onError: (error) => toast.error('Could not update', error instanceof Error ? error.message : undefined),
  });

  const secondsLeft = bill.stepEndsAt ? Math.max(0, Math.ceil((new Date(bill.stepEndsAt).getTime() - now) / 1000)) : 0;
  const code = bill.passCode ? `${bill.passCode.slice(0, 3)} ${bill.passCode.slice(3)}` : '—';

  return (
    <div
      className={cn(
        'rounded-3xl bg-white p-4 shadow-card ring-1 ring-ink-200 transition-shadow sm:p-5',
        fresh && 'animate-enter shadow-lift ring-2 ring-brand-500',
      )}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="num text-[28px] font-black leading-none tracking-tight">{rupees(bill.amountPaidPaise)}</p>
          <p className="mt-1.5 text-[13px] text-ink-500">
            Bill {rupees(bill.billTotalPaise)} · {bill.dinerName}
            {bill.phoneLast4 && ` · ••${bill.phoneLast4}`} · {bill.paidAt ? ago(bill.paidAt, now) : ''}
          </p>
          {bill.reservationCode && <p className="mt-0.5 text-xs font-semibold text-save-700">Pre-booked · {bill.reservationCode}</p>}
        </div>
        <div className="rounded-2xl bg-ink-100 px-3.5 py-2 text-center">
          <p className="num text-2xl font-black tracking-[0.14em]">{code}</p>
          <p className="num text-[10.5px] font-semibold text-ink-500">matches diner’s screen · {secondsLeft}s</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setMismatchOpen(true)}
          className="press h-12 flex-1 rounded-2xl bg-white text-sm font-bold text-ink-700 ring-1 ring-inset ring-ink-300"
        >
          Mismatch
        </button>
        <button
          onClick={() => verify.mutate({ result: 'match' })}
          disabled={verify.isPending}
          className="press flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl bg-save-600 text-sm font-bold text-white hover:bg-save-700 disabled:opacity-60"
        >
          <Check className="h-5 w-5" strokeWidth={3} /> Matches
        </button>
      </div>

      <Sheet
        open={mismatchOpen}
        onClose={() => setMismatchOpen(false)}
        title="What doesn’t match?"
        subtitle={`${rupees(bill.amountPaidPaise)} paid · bill entered as ${rupees(bill.billTotalPaise)}`}
        footer={
          <button
            onClick={() => verify.mutate({ result: 'mismatch', reason: reason || 'Amount or code did not match' })}
            disabled={verify.isPending}
            className="press mb-1 h-12 w-full rounded-2xl bg-amber-500 font-bold text-white disabled:opacity-60"
          >
            Flag for Tixit to review
          </button>
        }
      >
        <div className="space-y-2">
          {['Bill amount entered is lower than our bill', 'Code on the diner’s phone is different', 'Diner is not at this restaurant'].map((option) => (
            <button
              key={option}
              onClick={() => setReason(option)}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl p-3.5 text-left text-sm font-semibold ring-1 ring-inset',
                reason === option ? 'bg-amber-50 ring-amber-400' : 'ring-ink-200',
              )}
            >
              <span className={cn('h-4 w-4 rounded-full ring-2 ring-inset', reason === option ? 'bg-amber-500 ring-amber-500' : 'ring-ink-300')} />
              {option}
            </button>
          ))}
          <p className="pt-2 text-xs text-ink-500">The diner is told we’re checking. You can also ask them to pay any difference at the counter.</p>
        </div>
      </Sheet>
    </div>
  );
}

const NEXT_ACTION: Record<string, { action: 'accept' | 'seat' | 'complete'; label: string } | undefined> = {
  placed: { action: 'accept', label: 'Accept' },
  confirmed: { action: 'seat', label: 'Seat' },
  seated: undefined,
};

export function ArrivalRow({ reservation, restaurantId }: { reservation: Reservation; restaurantId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const next = NEXT_ACTION[reservation.status];
  const act = useMutation({
    mutationFn: async (action: string) => (await api.post<Reservation>(`/partner/r/${restaurantId}/reservations/${reservation.code}/${action}`, {})).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['partner-live', restaurantId] });
      void queryClient.invalidateQueries({ queryKey: ['partner-reservations', restaurantId] });
    },
    onError: (error) => toast.error('Could not update', error instanceof Error ? error.message : undefined),
  });
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="num w-[70px] shrink-0 text-sm font-extrabold">{timeOnly(reservation.startsAt)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{reservation.guestName}</span>
        <span className="flex items-center gap-1 text-xs text-ink-500">
          <Users className="h-3 w-3" /> {reservation.partySize}
          {reservation.occasion ? ` · ${reservation.occasion}` : ''}
          {reservation.offer ? ` · ${reservation.offer.headline}` : ''}
        </span>
      </span>
      {reservation.status === 'seated' ? (
        <span className="rounded-lg bg-ink-100 px-2 py-1 text-[11px] font-bold text-ink-600">Seated</span>
      ) : next ? (
        <button
          onClick={() => act.mutate(next.action)}
          disabled={act.isPending}
          className={cn(
            'press h-8 rounded-lg px-3 text-xs font-bold disabled:opacity-60',
            next.action === 'accept' ? 'bg-amber-500 text-white' : 'bg-ink-900 text-white',
          )}
        >
          {next.label}
        </button>
      ) : (
        <ChevronRight className="h-4 w-4 text-ink-300" />
      )}
      {reservation.status === 'placed' && (
        <button onClick={() => act.mutate('decline')} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Decline">
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
