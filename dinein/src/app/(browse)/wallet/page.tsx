'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Clock3, Hourglass, Sparkles, Undo2 } from 'lucide-react';
import { api } from '@tixit/session';
import type { Wallet } from '@/lib/types';
import { cn, dateTime, relativeDay, rupees } from '@/lib/format';
import { RequireAuth } from '@/components/auth/require-auth';
import { EmptyState, Skeleton } from '@/components/ui/feedback';

const ACTIVITY: Record<Wallet['activity'][number]['kind'], { label: string; icon: typeof Sparkles; tone: string }> = {
  cashback: { label: 'Cashback', icon: ArrowDownLeft, tone: 'bg-save-50 text-save-600' },
  cashback_pending: { label: 'Cashback on the way', icon: Hourglass, tone: 'bg-amber-50 text-amber-600' },
  cashback_reversed: { label: 'Cashback reversed', icon: Undo2, tone: 'bg-rose-50 text-rose-600' },
  cashback_expired: { label: 'Cashback expired', icon: Clock3, tone: 'bg-ink-100 text-ink-500' },
  spent: { label: 'Spent on a bill', icon: ArrowUpRight, tone: 'bg-ink-100 text-ink-600' },
};

function WalletView() {
  const { data, isLoading } = useQuery({ queryKey: ['wallet'], queryFn: async () => (await api.get<Wallet>('/wallet')).data });
  if (isLoading || !data) return <Skeleton className="mt-6 h-64 rounded-3xl" />;

  return (
    <>
      <div className="night mt-5 rounded-[28px] p-6">
        <p className="eyebrow text-brand-300">Tixit Wallet</p>
        <p className="num mt-1 text-5xl font-black tracking-tight">{rupees(data.availablePaise)}</p>
        <p className="mt-1 text-sm text-ink-300">Ready to spend on any bill you pay on Tixit</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">On the way</p>
            <p className="num mt-0.5 text-lg font-extrabold">{rupees(data.pendingPaise)}</p>
          </div>
          <div className="glass rounded-2xl p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Expiring in 14 days</p>
            <p className="num mt-0.5 text-lg font-extrabold">{rupees(data.expiringSoonPaise)}</p>
          </div>
        </div>
        {data.availablePaise > 0 && (
          <Link href="/pay" className="press mt-5 inline-flex h-11 items-center rounded-2xl bg-white px-5 text-sm font-bold text-ink-900">
            Use it on a bill
          </Link>
        )}
      </div>

      <div className="mt-4 rounded-3xl bg-white p-5 ring-1 ring-ink-200">
        <p className="flex items-center gap-2 font-bold">
          <Sparkles className="h-4 w-4 text-brand-600" /> How cashback works
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-600">
          <li>Earn cashback on every restaurant bill you pay on Tixit.</li>
          <li>It lands a day after staff verify your payment at the table.</li>
          <li>Spend it on up to half of any later bill; unspent cashback expires after 90 days.</li>
        </ul>
      </div>

      <h2 className="eyebrow mt-8 text-ink-400">Activity</h2>
      {data.activity.length === 0 ? (
        <EmptyState className="mt-2" icon={Sparkles} title="No cashback yet" body="Pay your next restaurant bill on Tixit to start earning." />
      ) : (
        <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
          {data.activity.map((item, index) => {
            const meta = ACTIVITY[item.kind];
            const Icon = meta.icon;
            return (
              <li key={index} className="flex items-center gap-3 p-4">
                <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', meta.tone)}>
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {meta.label}
                    {item.label ? ` · ${item.label}` : ''}
                  </span>
                  <span className="block text-xs text-ink-500">
                    {item.availableAt ? `Spendable ${relativeDay(item.availableAt).toLowerCase()}` : dateTime(item.at)}
                  </span>
                </span>
                <span className={cn('num text-sm font-bold', item.amountPaise < 0 ? 'text-ink-700' : item.kind === 'cashback' ? 'text-save-700' : 'text-ink-400')}>
                  {item.amountPaise < 0 ? '−' : '+'}
                  {rupees(Math.abs(item.amountPaise))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function WalletPage() {
  return (
    <div className="container-page max-w-2xl py-6 sm:py-10">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Wallet</h1>
      <p className="mt-1 text-sm text-ink-500">Your Tixit cashback — one balance across your Tixit account.</p>
      <Suspense>
        <RequireAuth>
          <WalletView />
        </RequireAuth>
      </Suspense>
    </div>
  );
}
