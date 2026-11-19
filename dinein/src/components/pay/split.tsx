'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock3, Copy, Share2, Users } from 'lucide-react';
import { ApiError, api, openCheckout, PAYMENT_CANCELLED } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { Bill, BillCheckout, SplitForHost } from '@/lib/types';
import { cn, rupees } from '@/lib/format';
import { Photo } from '@/components/ui/photo';
import { Spinner } from '@/components/ui/feedback';

export function shareUrl(token: string): string {
  return `${window.location.origin}/split/${token}`;
}

/** "1h 52m left", ticking. */
export function useCountdown(until: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  if (!until) return null;
  const minutes = Math.max(0, Math.round((new Date(until).getTime() - now) / 60_000));
  if (minutes <= 0) return 'Closing now';
  const h = Math.floor(minutes / 60);
  return `${h ? `${h}h ` : ''}${minutes % 60}m left`;
}

/** Pay one share: open (or reuse) its order, run the gateway, confirm. */
export function useSharePayment(onPaid: () => void) {
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ token, checkout }: { token: string; checkout?: BillCheckout }) => {
      const order = checkout ?? (await api.post<BillCheckout>(`/dining/splits/${token}/checkout`)).data;
      const outcome = await openCheckout(order, { description: `Your share at ${order.restaurantName}` });
      await api.post(`/dining/splits/${token}/verify-payment`, {
        razorpayOrderId: outcome.orderId,
        razorpayPaymentId: outcome.paymentId,
        razorpaySignature: outcome.signature,
      });
    },
    onSuccess: () => {
      toast.success('Share paid', 'Thanks — the bill updates for everyone.');
      onPaid();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === PAYMENT_CANCELLED) return;
      toast.error('Payment didn’t go through', error instanceof ApiError ? error.message : 'Please try again.');
      onPaid();
    },
  });
}

async function sendLink(token: string, restaurant: string, amountPaise: number, toastSuccess: (t: string) => void) {
  const url = shareUrl(token);
  const text = `My share of dinner at ${restaurant} is ${rupees(amountPaise, { decimals: true })} — pay it on Tixit:`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Split the bill', text, url });
      return;
    } catch {
      // Dismissed, or the share sheet is unavailable — fall back to copying.
    }
  }
  await navigator.clipboard?.writeText(`${text} ${url}`).catch(() => undefined);
  toastSuccess('Link copied');
}

/**
 * The host's screen while a split is open: who has paid, a link for each
 * share, and the two ways out — cover the rest, or call it off.
 */
export function SplitHost({ bill }: { bill: Bill }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const split = useQuery({
    queryKey: ['split', bill.code],
    queryFn: async () => (await api.get<SplitForHost>(`/dining/bills/${bill.code}/split`)).data,
    refetchInterval: (query) => (query.state.data?.status === 'pending_payment' ? 4000 : false),
  });
  const data = split.data;
  const countdown = useCountdown(data?.status === 'pending_payment' ? data.expiresAt : null);

  // When the last share lands the bill becomes a live pass.
  useEffect(() => {
    if (data && data.status !== bill.status) void queryClient.invalidateQueries({ queryKey: ['bill', bill.code] });
  }, [data, bill.status, bill.code, queryClient]);

  const refresh = () => {
    void split.refetch();
    void queryClient.invalidateQueries({ queryKey: ['bill', bill.code] });
  };
  const payShare = useSharePayment(refresh);

  const cover = useMutation({
    mutationFn: async () => (await api.post<BillCheckout>(`/dining/bills/${bill.code}/split/cover`)).data,
    // The server folds the open shares into one and returns its order; the
    // checkout's code is that share's token.
    onSuccess: (checkout) => payShare.mutate({ token: checkout.code, checkout }),
    onError: (error) => toast.error('Could not do that', error instanceof ApiError ? error.message : undefined),
  });

  const cancel = useMutation({
    mutationFn: async () => api.post(`/dining/bills/${bill.code}/split/cancel`),
    onSuccess: () => {
      toast.success('Split called off', data?.paidCount ? 'Everyone who paid is being refunded.' : undefined);
      refresh();
    },
    onError: (error) => toast.error('Could not do that', error instanceof ApiError ? error.message : undefined),
  });

  if (!data) {
    return (
      <div className="night grid min-h-dvh place-items-center">
        <Spinner className="border-white/20 border-t-white" />
      </div>
    );
  }

  const closed = data.status !== 'pending_payment';
  const busy = payShare.isPending || cover.isPending || cancel.isPending;
  const progress = data.totalPaise ? data.paidPaise / data.totalPaise : 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-8">
      <div className="text-center">
        <p className="eyebrow mt-4 text-brand-300">{closed ? 'Split called off' : 'Splitting the bill'}</p>
        <div className="mt-3 flex items-center justify-center gap-2">
          <Photo src={bill.restaurant.logoUrl} alt="" sizes="28px" className="h-7 w-7 rounded-lg" />
          <span className="font-bold">{bill.restaurant.name}</span>
        </div>
        <p className="num mt-2 text-[44px] font-black leading-none tracking-tight">{rupees(data.totalPaise, { decimals: true })}</p>
        {bill.pricing.totalDiscountPaise > 0 && (
          <p className="mt-2 text-sm text-ink-300">
            Offers already applied — everyone saves <b className="text-save-300">{rupees(bill.pricing.totalDiscountPaise)}</b>
          </p>
        )}
      </div>

      {closed ? (
        <p className="glass mt-8 rounded-3xl p-5 text-center text-sm leading-relaxed text-ink-200">
          Nothing was charged to the restaurant.{' '}
          {data.paidCount > 0 ? 'Everyone who paid a share is refunded to their original payment method within 5–7 working days.' : ''}
        </p>
      ) : (
        <>
          <div className="mt-7">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold">
                {data.paidCount} of {data.shareCount} paid
              </span>
              {countdown && (
                <span className="flex items-center gap-1.5 text-ink-300">
                  <Clock3 className="h-3.5 w-3.5" /> {countdown}
                </span>
              )}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-gradient-to-r from-save-400 to-save-500 transition-all duration-700" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>

          <ul className="mt-5 space-y-2.5">
            {data.shares.map((share) => {
              const mine = share.shareNo === 1;
              const paid = share.status === 'paid';
              return (
                <li key={share.shareNo} className={cn('glass flex items-center gap-3 rounded-2xl p-3.5', paid && 'opacity-80')}>
                  <span
                    className={cn(
                      'grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black',
                      paid ? 'bg-save-500 text-white' : 'bg-white/10 text-ink-200',
                    )}
                  >
                    {paid ? <Check className="h-5 w-5" strokeWidth={3} /> : share.shareNo}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="num block font-bold">{rupees(share.amountPaise, { decimals: true })}</span>
                    <span className="block truncate text-xs text-ink-300">
                      {paid ? `Paid by ${share.paidBy ?? 'a friend'}` : mine ? 'Your share' : 'Waiting for a friend'}
                    </span>
                  </span>
                  {!paid &&
                    (mine ? (
                      <button
                        onClick={() => payShare.mutate({ token: share.token })}
                        disabled={busy}
                        className="press h-10 shrink-0 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white shadow-glow disabled:opacity-60"
                      >
                        Pay
                      </button>
                    ) : (
                      <span className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => void sendLink(share.token, bill.restaurant.name, share.amountPaise, (t) => toast.success(t))}
                          className="press inline-flex h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-bold text-ink-900"
                        >
                          <Share2 className="h-4 w-4" /> Send
                        </button>
                        <button
                          onClick={() => {
                            void navigator.clipboard?.writeText(shareUrl(share.token));
                            toast.success('Link copied');
                          }}
                          className="press grid h-10 w-10 place-items-center rounded-xl bg-white/10"
                          aria-label={`Copy link for share ${share.shareNo}`}
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </span>
                    ))}
                </li>
              );
            })}
          </ul>

          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-400">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Your pass appears here once every share is paid. If the time runs out, everyone who paid is refunded.
          </p>

          <div className="mt-auto space-y-2 pt-8">
            {data.remainingPaise > 0 && (
              <button
                onClick={() => cover.mutate()}
                disabled={busy}
                className="press flex h-12 w-full items-center justify-center rounded-2xl bg-white text-sm font-bold text-ink-900 disabled:opacity-60"
              >
                {cover.isPending || payShare.isPending ? <Spinner /> : `Cover the rest · ${rupees(data.remainingPaise, { decimals: true })}`}
              </button>
            )}
            <button
              onClick={() => {
                if (window.confirm(data.paidCount ? 'Call off the split? Everyone who paid will be refunded.' : 'Call off the split?')) cancel.mutate();
              }}
              disabled={busy}
              className="press h-11 w-full rounded-2xl text-sm font-bold text-ink-300 disabled:opacity-60"
            >
              Call off the split
            </button>
          </div>
        </>
      )}
    </main>
  );
}
