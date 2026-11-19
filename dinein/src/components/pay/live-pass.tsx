'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Star, X } from 'lucide-react';
import { api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { Bill } from '@/lib/types';
import { cn, dateTime, rupees } from '@/lib/format';
import { Photo } from '@/components/ui/photo';
import { Spinner } from '@/components/ui/feedback';
import { Receipt } from './receipt';
import { SplitHost } from './split';
import { PhotoPicker, uploadReviewPhotos, type PickedPhoto } from '@/components/review/photo-picker';

const RING = 2 * Math.PI * 96;

/** Keep the screen awake while the pass is being shown to staff. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, [active]);
}

/**
 * The pass a diner shows at the table.
 *
 * Anti-screenshot by design: a six-digit code that rotates every 30 seconds
 * (the same code is on the staff's screen), a server-synced clock ticking in
 * seconds, and a slow gradient sweep. A still image is visibly stale in
 * moments. When staff tap "Matches", the pass flips to a verified receipt.
 */
export function LivePass({ code }: { code: string }) {
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);

  const bill = useQuery({
    queryKey: ['bill', code],
    queryFn: async () => {
      const sent = Date.now();
      const { data } = await api.get<Bill>(`/dining/bills/${code}`);
      if (data.pass) offset.current = new Date(data.pass.serverNow).getTime() - (sent + Date.now()) / 2;
      return data;
    },
    // While waiting for staff, poll; the code itself is refetched as each step ends.
    refetchInterval: (query) => (query.state.data?.status === 'paid' ? 4000 : false),
  });

  const data = bill.data;
  const live = data?.status === 'paid';
  useWakeLock(live);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const serverNow = now + offset.current;
  const stepEnds = data?.pass ? new Date(data.pass.stepEndsAt).getTime() : 0;
  const secondsLeft = Math.max(0, Math.ceil((stepEnds - serverNow) / 1000));

  // Fetch the next code the moment this one expires.
  useEffect(() => {
    if (live && stepEnds && serverNow >= stepEnds) void bill.refetch();
  }, [live, stepEnds, serverNow, bill]);

  const clockText = useMemo(
    () => new Date(serverNow).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }),
    [serverNow],
  );

  if (bill.isLoading) {
    return (
      <div className="night grid min-h-dvh place-items-center">
        <Spinner className="border-white/20 border-t-white" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-lg font-bold">We couldn’t find that bill</p>
          <Link href="/bookings" className="mt-3 inline-block text-sm font-bold text-brand-600">
            Go to your plans
          </Link>
        </div>
      </div>
    );
  }

  if (data.splitCount > 1 && (data.status === 'pending_payment' || data.status === 'cancelled')) {
    return (
      <div className="night flex min-h-dvh flex-col">
        <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-4">
          <Link href="/bookings" className="glass press grid h-10 w-10 place-items-center rounded-full" aria-label="Done">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="num text-xs font-semibold text-ink-400">{data.code}</span>
        </header>
        <SplitHost bill={data} />
      </div>
    );
  }

  const verified = data.status === 'verified';
  const disputed = data.status === 'disputed';
  const formatted = data.pass ? `${data.pass.code.slice(0, 3)} ${data.pass.code.slice(3)}` : '';

  return (
    <div className="night flex min-h-dvh flex-col">
      {live && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-[-40%] -z-10 animate-sweep"
          style={{ background: 'conic-gradient(from 0deg, transparent 0 68%, rgb(244 63 94 / 0.22) 80%, transparent 92%)' }}
        />
      )}

      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-4">
        <Link href="/bookings" className="glass press grid h-10 w-10 place-items-center rounded-full" aria-label="Done">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="num text-xs font-semibold text-ink-400">{data.code}</span>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-5 pb-8 text-center">
        <p className="eyebrow mt-4 text-brand-300">
          {verified ? 'All done' : disputed ? 'Needs a quick check' : 'Payment successful'}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Photo src={data.restaurant.logoUrl} alt="" sizes="28px" className="h-7 w-7 rounded-lg" />
          <span className="font-bold">{data.restaurant.name}</span>
        </div>
        <p className="num mt-2 text-[52px] font-black leading-none tracking-tight">{rupees(data.amountPaidPaise)}</p>
        {data.pricing.totalDiscountPaise > 0 && (
          <p className="mt-2 text-sm text-ink-300">
            You saved <b className="text-save-300">{rupees(data.pricing.totalDiscountPaise)}</b>
          </p>
        )}

        <div className="mt-8 [perspective:1000px]">
          <div
            className={cn(
              'relative h-[212px] w-[212px] transition-transform duration-700 ease-smooth [transform-style:preserve-3d]',
              (verified || disputed) && '[transform:rotateY(180deg)]',
            )}
          >
            {/* front: rotating code */}
            <div className="absolute inset-0 [backface-visibility:hidden]">
              <svg viewBox="0 0 212 212" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="106" cy="106" r="96" stroke="rgb(255 255 255 / 0.1)" strokeWidth="8" fill="none" />
                <circle
                  cx="106"
                  cy="106"
                  r="96"
                  stroke="url(#pass-ring)"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={RING}
                  strokeDashoffset={RING * (1 - secondsLeft / (data.pass?.stepSeconds ?? 30))}
                  style={{ transition: 'stroke-dashoffset 0.25s linear' }}
                />
                <defs>
                  <linearGradient id="pass-ring">
                    <stop offset="0" stopColor="#fb7185" />
                    <stop offset="1" stopColor="#e11d48" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center" aria-live="polite">
                <span className="text-[11px] font-semibold text-ink-300">Verification code</span>
                <span className="num mt-1 whitespace-nowrap text-[34px] font-black tracking-[0.05em]">{formatted}</span>
                <span className="num text-[11px] font-semibold text-ink-300">changes in {secondsLeft}s</span>
              </div>
            </div>
            {/* back: verified / disputed */}
            <div className="absolute inset-0 flex flex-col items-center justify-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <span
                className={cn(
                  'grid h-24 w-24 place-items-center rounded-full text-white',
                  disputed ? 'bg-amber-500 shadow-[0_0_0_12px_rgb(245_158_11/0.2)]' : 'bg-save-600 shadow-[0_0_0_12px_rgb(5_150_105/0.22),0_0_0_26px_rgb(5_150_105/0.1)]',
                )}
              >
                {disputed ? <X className="h-11 w-11" strokeWidth={3} /> : <Check className="h-12 w-12" strokeWidth={3} />}
              </span>
              <span className="mt-5 text-lg font-bold">{disputed ? 'Staff flagged a mismatch' : 'Verified by staff'}</span>
              <span className="mt-1 text-xs text-ink-300">
                {disputed ? 'We’ll sort it out — check your email.' : data.verifiedAt ? dateTime(data.verifiedAt) : ''}
              </span>
            </div>
          </div>
        </div>

        {live && (
          <>
            <p className="mt-6 flex items-center gap-2 text-sm font-semibold text-ink-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-save-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-save-400" />
              </span>
              <span className="num">{clockText}</span> · live
            </p>
            <p className="mt-auto pt-8 text-sm leading-relaxed text-ink-300">
              Show this screen to the staff.
              <br />
              The code and clock change live, so a screenshot won’t work.
            </p>
          </>
        )}

        {(verified || disputed) && <AfterPayment bill={data} />}
      </main>
    </div>
  );
}

function AfterPayment({ bill }: { bill: Bill }) {
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(!bill.canReview);
  const [sending, setSending] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);

  async function submit() {
    setSending(true);
    try {
      const { data } = await api.post<{ id: string }>('/dining/reviews', { billCode: bill.code, rating, body: body.trim() || null });
      const failed = photos.length ? await uploadReviewPhotos(data.id, photos) : 0;
      setSent(true);
      if (failed) toast.error('Review posted', `${failed} photo${failed > 1 ? 's' : ''} could not be uploaded.`);
      else toast.success('Thanks for the review');
    } catch (error) {
      toast.error('Could not save your review', error instanceof Error ? error.message : undefined);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-8 w-full animate-enter space-y-3 text-left text-ink-900">
      {!sent && (
        <div className="rounded-3xl bg-white p-5">
          <p className="font-bold">How was {bill.restaurant.name}?</p>
          <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                role="radio"
                aria-checked={rating === value}
                onClick={() => setRating(value)}
                className="press"
                aria-label={`${value} star${value > 1 ? 's' : ''}`}
              >
                <Star className={cn('h-9 w-9', value <= rating ? 'fill-amber-400 stroke-amber-400' : 'stroke-ink-300')} />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <div className="animate-enter">
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value.slice(0, 1000))}
                rows={3}
                placeholder="What stood out? (optional)"
                className="input mt-3 resize-none text-sm"
              />
              <PhotoPicker photos={photos} onChange={setPhotos} />
              <button
                onClick={submit}
                disabled={sending}
                className="press mt-3 h-12 w-full rounded-2xl bg-ink-900 text-sm font-bold text-white disabled:opacity-60"
              >
                {sending ? (photos.length ? 'Uploading photos…' : 'Saving…') : 'Post review'}
              </button>
            </div>
          )}
        </div>
      )}
      <Receipt pricing={bill.pricing} restaurant={bill.restaurant} subtitle={bill.paidAt ? `Paid ${dateTime(bill.paidAt)}` : undefined} />
      <Link href="/bookings" className="press flex h-12 items-center justify-center rounded-2xl bg-white/10 text-sm font-bold text-white ring-1 ring-inset ring-white/15">
        Done
      </Link>
    </div>
  );
}
