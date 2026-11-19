'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Clock3, Lock, Users } from 'lucide-react';
import { api, useAuth } from '@tixit/session';
import type { SharePage } from '@/lib/types';
import { rupees } from '@/lib/format';
import { Photo } from '@/components/ui/photo';
import { Spinner } from '@/components/ui/feedback';
import { useCountdown, useSharePayment } from './split';

/**
 * What a friend sees from a share link: who split it, where, their amount,
 * and one button. Viewable signed out; paying needs a Tixit account (the
 * same one works on tixit.in).
 */
export function SharePay({ token }: { token: string }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const share = useQuery({
    queryKey: ['share', token, user?.id ?? null],
    queryFn: async () => (await api.get<SharePage>(`/dining/splits/${token}`)).data,
    enabled: !loading,
    refetchInterval: (query) => (query.state.data?.billStatus === 'pending_payment' ? 5000 : false),
  });
  const pay = useSharePayment(() => void share.refetch());
  const data = share.data;
  const countdown = useCountdown(data?.billStatus === 'pending_payment' ? data.expiresAt : null);

  if (share.isLoading || loading) {
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
          <p className="text-lg font-bold">This link doesn’t work</p>
          <p className="mt-1 text-sm text-ink-500">Ask whoever sent it for a fresh one.</p>
          <Link href="/" className="mt-3 inline-block text-sm font-bold text-brand-600">
            Explore Tixit Dine-in
          </Link>
        </div>
      </div>
    );
  }

  const open = data.status === 'open' && data.billStatus === 'pending_payment';
  const complete = ['paid', 'verified'].includes(data.billStatus);
  const closed = !open && !complete && !(data.status === 'paid' && data.billStatus === 'pending_payment');
  const progress = data.totalPayablePaise ? data.paidPaise / data.totalPayablePaise : 0;

  function startPay() {
    if (!user) {
      router.push(`/auth/login?next=${encodeURIComponent(pathname)}&reason=pay`);
      return;
    }
    pay.mutate({ token });
  }

  return (
    <div className="night flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-4">
        <Link href="/" className="glass press grid h-10 w-10 place-items-center rounded-full" aria-label="Tixit Dine-in home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="text-xs font-semibold text-ink-400">Share {data.shareNo} of {data.shareCount}</span>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-8 text-center">
        <p className="eyebrow mt-4 text-brand-300">{data.paidByYou ? 'You’re all set' : `${data.host} split the bill`}</p>
        <div className="mt-3 flex items-center justify-center gap-2">
          <Photo src={data.restaurant.logoUrl} alt="" sizes="28px" className="h-7 w-7 rounded-lg" />
          <span className="font-bold">{data.restaurant.name}</span>
          <span className="text-sm text-ink-400">· {data.restaurant.locality}</span>
        </div>

        {data.paidByYou ? (
          <div className="mt-8 flex flex-col items-center">
            <span className="grid h-24 w-24 animate-enter place-items-center rounded-full bg-save-600 shadow-[0_0_0_12px_rgb(5_150_105/0.22),0_0_0_26px_rgb(5_150_105/0.1)]">
              <Check className="h-12 w-12" strokeWidth={3} />
            </span>
            <p className="num mt-6 text-3xl font-black">{rupees(data.amountPaise, { decimals: true })} paid</p>
            <p className="mt-1 text-sm text-ink-300">
              {complete ? 'Everyone has paid — the table is settled.' : `Waiting for ${data.shareCount - data.paidCount} more.`}
            </p>
          </div>
        ) : (
          <>
            <p className="mt-6 text-sm text-ink-300">Your share</p>
            <p className="num mt-1 text-[52px] font-black leading-none tracking-tight">{rupees(data.amountPaise, { decimals: true })}</p>
            {data.savedPaise > 0 && (
              <p className="mt-2 text-sm text-ink-300">
                Offers already applied — the table saved <b className="text-save-300">{rupees(data.savedPaise)}</b>
              </p>
            )}
          </>
        )}

        <div className="glass mt-8 rounded-3xl p-4 text-left">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-bold">
              <Users className="h-4 w-4 text-ink-300" /> {data.paidCount} of {data.shareCount} paid
            </span>
            {countdown && (
              <span className="flex items-center gap-1.5 text-xs text-ink-300">
                <Clock3 className="h-3.5 w-3.5" /> {countdown}
              </span>
            )}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-save-400 to-save-500 transition-all duration-700" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="num mt-2 text-xs text-ink-400">
            Bill {rupees(data.billTotalPaise)} · paying {rupees(data.totalPayablePaise, { decimals: true })} after offers
          </p>
        </div>

        {data.isHost && data.billCode && (
          <Link href={`/bills/${data.billCode}`} className="mt-3 text-sm font-bold text-brand-300">
            Manage the split →
          </Link>
        )}

        {closed && !data.paidByYou && (
          <p className="mt-6 text-sm leading-relaxed text-ink-300">
            {data.status === 'paid'
              ? 'Someone has already paid this share.'
              : data.status === 'void'
                ? `${data.host} covered the rest of the bill. Nothing to pay.`
                : 'This split has closed. If you paid, the refund is on its way.'}
          </p>
        )}

        {open && (
          <div className="mt-auto pt-8">
            <button
              onClick={startPay}
              disabled={pay.isPending}
              className="press flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[16px] font-bold text-white shadow-glow disabled:opacity-60"
            >
              {pay.isPending ? (
                <Spinner className="border-white/40 border-t-white" />
              ) : (
                <>
                  <Lock className="h-4 w-4" /> {user ? `Pay ${rupees(data.amountPaise, { decimals: true })}` : 'Sign in to pay your share'}
                </>
              )}
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-400">
              Secured by Razorpay · UPI · Cards · You earn Tixit cashback on your share
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
