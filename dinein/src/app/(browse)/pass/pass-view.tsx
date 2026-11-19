'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, CalendarPlus, Check, Crown, ReceiptText } from 'lucide-react';
import { ApiError, api, openCheckout, PAYMENT_CANCELLED, useAuth } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { BillCheckout, PassInfo } from '@/lib/types';
import { rupees } from '@/lib/format';
import { Skeleton, Spinner } from '@/components/ui/feedback';

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/**
 * Tixit Pass. The promise is two perks that are applied where the money is
 * worked out — the receipt shows the fee as "Free" and cashback lands doubled —
 * so the page can state them plainly without fine print.
 */
export function PassView() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pass = useQuery({
    queryKey: ['pass', user?.id ?? null],
    queryFn: async () => (await api.get<PassInfo>('/pass')).data,
    enabled: !loading,
  });

  const buy = useMutation({
    mutationFn: async () => {
      const { data: checkout } = await api.post<BillCheckout>('/pass/checkout');
      const outcome = await openCheckout(checkout, { description: 'Tixit Pass' });
      return (
        await api.post<PassInfo>('/pass/verify-payment', {
          razorpayOrderId: outcome.orderId,
          razorpayPaymentId: outcome.paymentId,
          razorpaySignature: outcome.signature,
        })
      ).data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['pass', user?.id ?? null], data);
      void queryClient.invalidateQueries({ queryKey: ['bill-quote'] });
      toast.success('Welcome to Tixit Pass', 'Your next bill has no platform fee.');
    },
    onError: (error) => {
      if (error instanceof Error && error.message === PAYMENT_CANCELLED) return;
      toast.error('Payment didn’t go through', error instanceof ApiError ? error.message : 'Please try again.');
    },
  });

  const plan = pass.data?.plan;
  const membership = pass.data?.membership;
  const months = plan ? Math.round(plan.days / 30) : 3;

  function start() {
    if (!user) {
      router.push(`/auth/login?next=${encodeURIComponent(pathname)}&reason=pass`);
      return;
    }
    buy.mutate();
  }

  const perks = plan
    ? [
        { icon: ReceiptText, title: 'No platform fee, ever', body: `Save ${rupees(plan.feePaise)} on every restaurant bill you pay on Tixit.` },
        { icon: BadgePercent, title: `${plan.cashbackMultiplier}× cashback`, body: 'Double the Tixit Wallet cashback on every bill — on split shares too.' },
        { icon: CalendarPlus, title: 'Renew any time', body: 'Buy again early and the new days add on to the end. Nothing is lost.' },
      ]
    : [];

  return (
    <div className="container-page max-w-2xl py-6 sm:py-10">
      <div className="night relative overflow-hidden rounded-[32px] p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-600/30 blur-3xl" />
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-brand-500 text-ink-950 shadow-glow">
          <Crown className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Tixit Pass</h1>
        {pass.isLoading || !plan ? (
          <Skeleton className="mt-3 h-10 w-48 bg-white/10" />
        ) : (
          <p className="mt-2 text-ink-300">
            <span className="num text-3xl font-black text-white">{rupees(plan.pricePaise)}</span> for {months} months · GST included
          </p>
        )}

        {membership?.active && membership.validUntil && (
          <div className="glass mt-5 rounded-2xl p-4">
            <p className="flex items-center gap-2 font-bold">
              <Check className="h-4 w-4 text-save-300" strokeWidth={3} /> You’re a member until {longDate(membership.validUntil)}
            </p>
            <p className="mt-1 text-sm text-ink-300">
              {membership.feesSavedPaise > 0
                ? `Saved ${rupees(membership.feesSavedPaise)} in fees on ${membership.billsWithPass} bill${membership.billsWithPass === 1 ? '' : 's'} so far.`
                : 'Your next bill on Tixit has no platform fee.'}
            </p>
          </div>
        )}

        <button
          onClick={start}
          disabled={buy.isPending || pass.isLoading}
          className="press mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-white text-[16px] font-bold text-ink-900 disabled:opacity-60"
        >
          {buy.isPending ? (
            <Spinner />
          ) : !user ? (
            'Sign in to get Tixit Pass'
          ) : membership?.active ? (
            `Add ${months} more months · ${plan ? rupees(plan.pricePaise) : ''}`
          ) : (
            `Get Tixit Pass · ${plan ? rupees(plan.pricePaise) : ''}`
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-ink-400">One payment, no auto-renewal. Works across Tixit with the same account.</p>
      </div>

      <ul className="mt-5 space-y-3">
        {perks.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-4 rounded-3xl bg-white p-5 ring-1 ring-ink-200">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              <Icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block font-bold">{title}</span>
              <span className="mt-0.5 block text-sm text-ink-600">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
