'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Check, MapPin, PartyPopper, ShieldCheck } from 'lucide-react';
import { ApiError, PAYMENT_CANCELLED, api, useAuth } from '@tixit/session';
import { payDeposit } from '@/lib/deposit';
import { useToast } from '@tixit/ui';
import type { Reservation, SlotView } from '@/lib/types';
import { addDays, clock, cn, dateTime, dayPill, localDate, rupees, shortClock } from '@/lib/format';
import { directionsUrl } from '@/lib/urls';
import { Stepper } from '@/components/ui/controls';
import { Skeleton, Spinner } from '@/components/ui/feedback';

const OCCASIONS = ['Birthday', 'Anniversary', 'Date night', 'Business', 'Window seat'];

interface Props {
  restaurant: { slug: string; name: string; lat: number; lng: number; coverChargePerGuestPaise?: number };
  /** Pre-select a slot from a "7:30 · 30% off" chip tapped elsewhere. */
  initialSlotId?: string | null;
  horizonDays?: number;
}

/**
 * Guests → day → time, in one surface. Each time shows the offer it locks in,
 * and the confirm button reads the whole choice back so nobody books the
 * wrong evening. Used inline on desktop and inside a sheet on phones.
 */
export function BookingPanel({ restaurant, initialSlotId, horizonDays = 7 }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = localDate();

  const [party, setParty] = useState(2);
  const [date, setDate] = useState(today);
  const [slotId, setSlotId] = useState<string | null>(initialSlotId ?? null);
  const [occasion, setOccasion] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [booked, setBooked] = useState<Reservation | null>(null);

  const days = useMemo(() => Array.from({ length: horizonDays }, (_, i) => addDays(today, i)), [today, horizonDays]);

  const slots = useQuery({
    queryKey: ['slots', restaurant.slug, date, party],
    queryFn: async () =>
      (await api.get<{ date: string; slots: Array<SlotView & { available: boolean }> }>(`/dining/restaurants/${restaurant.slug}/slots`, {
        query: { date, party },
      })).data.slots,
    refetchInterval: 60_000,
  });

  // Drop a selection that is no longer bookable for this party size.
  useEffect(() => {
    if (!slots.data || !slotId) return;
    const slot = slots.data.find((s) => s.id === slotId);
    if (!slot || !slot.available) setSlotId(null);
  }, [slots.data, slotId]);

  const selected = slots.data?.find((slot) => slot.id === slotId) ?? null;
  // The deepest offer among bookable times, by percentage then flat value.
  const offerRank = (offer: SlotView['offer']) => (offer ? (offer.percentOff ?? 0) * 1e9 + (offer.flatOffPaise ?? 0) : 0);
  const deepestRank = Math.max(0, ...(slots.data ?? []).filter((slot) => slot.available).map((slot) => offerRank(slot.offer)));

  const deposit = restaurant.coverChargePerGuestPaise ?? 0;

  const book = useMutation({
    mutationFn: async () => {
      const { data: reservation } = await api.post<Reservation>('/dining/reservations', {
        slotId,
        partySize: party,
        occasion,
        notes: notes.trim() || null,
      });
      if (reservation.status !== 'pending_payment') return reservation;
      // A deposit is due: take it now, while the table is held.
      try {
        return await payDeposit(reservation.code);
      } catch (error) {
        if (error instanceof Error && error.message === PAYMENT_CANCELLED) return reservation;
        throw error;
      }
    },
    onSuccess: (reservation) => {
      setBooked(reservation);
      void queryClient.invalidateQueries({ queryKey: ['slots', restaurant.slug] });
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'ALREADY_BOOKED') {
        const code = (error.details as { code?: string } | undefined)?.code;
        toast.error('You already have a table here that day', 'Open it from Your plans to change or cancel.');
        if (code) router.push(`/bookings/${code}`);
        return;
      }
      toast.error('Could not book that table', error instanceof Error ? error.message : undefined);
      void slots.refetch();
    },
  });

  function confirm() {
    if (!user) {
      const back = `${pathname}?book=1${slotId ? `&slot=${slotId}` : ''}`;
      router.push(`/auth/login?next=${encodeURIComponent(back)}&reason=book`);
      return;
    }
    book.mutate();
  }

  if (booked) return <BookingConfirmed reservation={booked} restaurant={restaurant} />;

  // Times already gone today are hidden, not shown as "Full" — that would be untrue.
  const bookableFrom = Date.now() + 15 * 60_000;
  const upcoming = slots.data?.filter((slot) => new Date(slot.startsAt).getTime() > bookableFrom) ?? [];
  const lunch = upcoming.filter((slot) => Number(slot.time.slice(0, 2)) < 17);
  const dinner = upcoming.filter((slot) => Number(slot.time.slice(0, 2)) >= 17);

  return (
    <div className="space-y-5">
      <section>
        <h3 className="eyebrow mb-2 text-ink-400">Guests</h3>
        <Stepper value={party} onChange={setParty} min={1} max={12} unit={['guest', 'guests']} />
      </section>

      <section>
        <h3 className="eyebrow mb-2 text-ink-400">Day</h3>
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((day) => {
            const pill = dayPill(day, today);
            const active = day === date;
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setDate(day);
                  setSlotId(null);
                }}
                aria-pressed={active}
                className={cn(
                  'press w-[58px] shrink-0 rounded-2xl py-2 text-center transition-colors',
                  active ? 'bg-ink-900 text-white' : 'bg-white ring-1 ring-inset ring-ink-200 hover:ring-ink-300',
                )}
              >
                <span className={cn('block text-[10.5px] font-bold uppercase', active ? 'text-ink-300' : 'text-ink-400')}>{pill.top}</span>
                <span className="num block text-lg font-extrabold leading-tight">{pill.day}</span>
                <span className={cn('block text-[10px] font-semibold', active ? 'text-ink-400' : 'text-ink-400')}>{pill.month}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="eyebrow text-ink-400">Time</h3>
          {deepestRank > 0 && <span className="text-xs font-bold text-save-700">Deepest offers highlighted</span>}
        </div>
        {slots.isLoading ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="h-[54px]" />
            ))}
          </div>
        ) : upcoming.some((slot) => slot.available) ? (
          <div className="space-y-4">
            {[
              ['Lunch', lunch],
              ['Dinner', dinner],
            ].map(([label, list]) =>
              (list as typeof lunch).length === 0 ? null : (
                <div key={label as string}>
                  <p className="mb-1.5 text-xs font-semibold text-ink-500">{label as string}</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {(list as typeof lunch).map((slot) => (
                      <SlotButton
                        key={slot.id}
                        slot={slot}
                        selected={slot.id === slotId}
                        deepest={deepestRank > 0 && offerRank(slot.offer) === deepestRank}
                        onSelect={() => setSlotId(slot.id)}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-ink-50 px-4 py-6 text-center text-sm text-ink-500 ring-1 ring-inset ring-ink-100">
            {upcoming.length === 0
              ? 'No more seatings on this day — try tomorrow.'
              : `No tables left for ${party} on this day. Try another day or fewer guests.`}
          </div>
        )}
      </section>

      {selected && (
        <section className="animate-enter">
          <h3 className="eyebrow mb-2 text-ink-400">Anything we should know?</h3>
          <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {OCCASIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setOccasion((value) => (value === item ? null : item))}
                aria-pressed={occasion === item}
                className={cn(
                  'press h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold',
                  occasion === item ? 'bg-brand-600 text-white' : 'bg-white text-ink-700 ring-1 ring-inset ring-ink-200',
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value.slice(0, 300))}
            placeholder="Allergies, high chair, a surprise cake… (optional)"
            rows={2}
            className="input mt-2.5 resize-none text-sm"
          />
        </section>
      )}

      <div className="space-y-2.5">
        {deposit > 0 ? (
          <div className="rounded-2xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
            <p className="font-bold">
              Table deposit: {rupees(deposit)} per guest{selected ? ` · ${rupees(deposit * party)} now` : ''}
            </p>
            <p className="mt-0.5">
              Credited to your bill when you pay on Tixit. Cancel 24 hours ahead for a full refund; later cancellations and
              no-shows keep the deposit.
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-ink-500">
            <ShieldCheck className="h-4 w-4 shrink-0 text-save-600" aria-hidden />
            Free booking · cancel any time before your table · offer applies when you pay on Tixit
          </p>
        )}
        <button
          type="button"
          onClick={confirm}
          disabled={!selected || book.isPending}
          className="press flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 text-[15px] font-bold text-white shadow-glow transition hover:bg-brand-700 disabled:bg-ink-200 disabled:text-ink-500 disabled:shadow-none"
        >
          {book.isPending ? (
            <Spinner className="border-white/40 border-t-white" />
          ) : selected ? (
            <span className="truncate">
              {deposit > 0 ? `Pay ${rupees(deposit * party)} & book` : 'Confirm'} · {dayPill(date, today).top === 'Today' ? 'Today' : `${dayPill(date, today).top} ${dayPill(date, today).day}`},{' '}
              {clock(selected.time)} · {party} {party === 1 ? 'guest' : 'guests'}
              {selected.offer ? ` · ${selected.offer.label}` : ''}
            </span>
          ) : (
            'Pick a time'
          )}
        </button>
      </div>
    </div>
  );
}

function SlotButton({
  slot,
  selected,
  deepest,
  onSelect,
}: {
  slot: SlotView & { available: boolean };
  selected: boolean;
  deepest: boolean;
  onSelect: () => void;
}) {
  const few = slot.available && slot.remaining <= 6;
  return (
    <button
      type="button"
      disabled={!slot.available}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'press relative rounded-xl py-2 text-center ring-1 ring-inset transition-all duration-200',
        !slot.available && 'cursor-not-allowed text-ink-300 ring-ink-100',
        slot.available && !selected && (deepest ? 'bg-save-50 ring-save-200 hover:ring-save-400' : 'bg-white ring-ink-200 hover:ring-ink-300'),
        selected && 'bg-ink-900 text-white shadow-lift ring-ink-900',
      )}
    >
      <span className={cn('num block text-sm font-bold', !slot.available && 'line-through')}>{shortClock(slot.time)}</span>
      <span
        className={cn(
          'block text-[10.5px] font-bold',
          !slot.available ? 'text-ink-300' : selected ? 'text-save-300' : slot.offer ? 'text-save-700' : 'text-ink-400',
        )}
      >
        {!slot.available ? 'Full' : (slot.offer?.label ?? 'No offer')}
      </span>
      {few && !selected && (
        <span className="absolute -right-1 -top-1.5 rounded-full bg-amber-500 px-1.5 text-[9px] font-extrabold uppercase text-white">
          Few left
        </span>
      )}
    </button>
  );
}

function calendarLink(reservation: Reservation): string {
  const start = new Date(reservation.startsAt);
  const end = new Date(start.getTime() + 2 * 3600_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Table at ${reservation.restaurant.name}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `Tixit booking ${reservation.code} for ${reservation.partySize}. ${reservation.offer ? reservation.offer.headline + ' when you pay on Tixit.' : ''}`,
    location: reservation.restaurant.address,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** A ticket-style confirmation — the same perforated card family as Tixit event tickets. */
export function BookingConfirmed({
  reservation,
  restaurant,
}: {
  reservation: Reservation;
  restaurant: { slug: string; name: string; lat: number; lng: number };
}) {
  const pending = reservation.status === 'placed';
  if (reservation.status === 'pending_payment') {
    return (
      <div className="animate-enter pt-4 text-center">
        <h3 className="text-xl font-extrabold tracking-tight">Your table is held</h3>
        <p className="mt-1 text-sm text-ink-500">
          Pay the {reservation.deposit ? rupees(reservation.deposit.amountPaise) : ''} deposit to confirm it before the hold runs out.
        </p>
        <Link
          href={`/bookings/${reservation.code}`}
          className="press mt-5 flex h-12 items-center justify-center rounded-2xl bg-brand-600 text-sm font-bold text-white shadow-glow"
        >
          Finish booking
        </Link>
      </div>
    );
  }
  return (
    <div className="animate-enter pt-4">
      <div className="flex flex-col items-center text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-save-600 text-white shadow-[0_0_0_10px_rgb(5_150_105/0.15)]">
          {pending ? <PartyPopper className="h-7 w-7" /> : <Check className="h-8 w-8" strokeWidth={3} />}
        </span>
        <h3 className="mt-4 text-xl font-extrabold tracking-tight">{pending ? 'Request sent' : 'Your table is booked'}</h3>
        <p className="mt-1 text-sm text-ink-500">
          {pending ? `${restaurant.name} usually confirms within 15 minutes.` : 'We’ll remind you two hours before.'}
        </p>
      </div>

      <div className="mt-5 overflow-hidden rounded-3xl bg-white shadow-lift ring-1 ring-ink-200">
        <div className="p-4">
          <p className="eyebrow text-ink-400">{restaurant.name}</p>
          <p className="mt-1 text-lg font-extrabold tracking-tight">{dateTime(reservation.startsAt)}</p>
          <p className="text-sm text-ink-500">
            {reservation.partySize} {reservation.partySize === 1 ? 'guest' : 'guests'}
            {reservation.occasion ? ` · ${reservation.occasion}` : ''}
          </p>
        </div>
        <div className="perforation" aria-hidden>
          <i />
        </div>
        <div className="flex items-center justify-between gap-3 bg-ink-50/60 p-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Booking code</p>
            <p className="num text-lg font-black tracking-[0.12em]">{reservation.code}</p>
          </div>
          {reservation.offer && (
            <span className="rounded-xl bg-save-600 px-3 py-2 text-right text-white">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-save-100">Locked in</span>
              <span className="block text-sm font-extrabold">{reservation.offer.headline}</span>
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={calendarLink(reservation)}
          target="_blank"
          rel="noreferrer"
          className="press flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-bold ring-1 ring-inset ring-ink-200"
        >
          <CalendarPlus className="h-4 w-4" /> Add to calendar
        </a>
        <a
          href={directionsUrl(restaurant.lat, restaurant.lng, restaurant.name)}
          target="_blank"
          rel="noreferrer"
          className="press flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-bold ring-1 ring-inset ring-ink-200"
        >
          <MapPin className="h-4 w-4" /> Directions
        </a>
      </div>
      <Link
        href={`/bookings/${reservation.code}`}
        className="press mt-2 flex h-12 items-center justify-center rounded-2xl bg-ink-900 text-sm font-bold text-white"
      >
        View booking
      </Link>
    </div>
  );
}
