'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Landmark } from 'lucide-react';
import { api } from '@tixit/session';
import type { CommissionInvoice, Payouts } from '@/lib/types';
import { cn, compactRupees, dateTime, rupees } from '@/lib/format';
import { PageHeading } from '@/components/partner/partner-shell';
import { Skeleton } from '@/components/ui/feedback';
import { usePartnerRestaurant } from '@/components/partner/use-partner';
import { InvoiceList } from '@/components/finance/invoice-list';

const MOVEMENT_LABEL: Record<string, string> = {
  bill_paid: 'Bill paid on Tixit',
  settlement: 'Paid to your bank',
  promotion_charged: 'Sponsored listing',
  promotion_cancelled: 'Sponsored listing cancelled',
  cover_forfeited: 'Table deposit kept',
  cover_unused: 'Unused table deposit',
};

export default function PartnerPayoutsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { restaurant } = usePartnerRestaurant(id);
  const canSeeInsights = restaurant?.capabilities.includes('insights.view');

  const payouts = useQuery({
    queryKey: ['partner-payouts', id],
    queryFn: async () => (await api.get<Payouts>(`/partner/r/${id}/payouts`)).data,
  });
  const insights = useQuery({
    queryKey: ['partner-insights', id],
    queryFn: async () => (await api.get<{ trend: Array<{ day: string; grossPaise: number; bills: number }> }>(`/partner/r/${id}/insights`)).data,
    enabled: Boolean(canSeeInsights),
  });

  const invoices = useQuery({
    queryKey: ['partner-invoices', id],
    queryFn: async () => (await api.get<CommissionInvoice[]>(`/partner/r/${id}/invoices`)).data,
  });

  const trend = insights.data?.trend ?? [];
  const peak = Math.max(1, ...trend.map((d) => d.grossPaise));

  return (
    <>
      <PageHeading title="Payouts" subtitle="Straight from the ledger — every rupee accounted for." />
      <div className="grid gap-4 px-4 pb-10 pt-5 sm:px-8 lg:grid-cols-[1fr_1.2fr]">
        <div className="min-w-0 space-y-4">
          <div className="night rounded-[28px] p-6">
            <p className="eyebrow text-brand-300">Due to you</p>
            {payouts.isLoading ? (
              <div className="mt-2 h-10 w-40 rounded-xl bg-white/10" />
            ) : (
              <p className="num mt-1 text-4xl font-black tracking-tight">{rupees(payouts.data?.balancePaise ?? 0)}</p>
            )}
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-300">
              <Landmark className="h-4 w-4" /> Settled weekly to your bank account
            </p>
          </div>

          {canSeeInsights && (
            <div className="rounded-3xl bg-white p-5 ring-1 ring-ink-200">
              <p className="eyebrow text-ink-400">Tixit sales · last 7 days</p>
              <div className="mt-4 flex h-36 items-end gap-2" role="img" aria-label="Daily Tixit sales for the last seven days">
                {trend.map((day) => (
                  <div key={day.day} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="num text-[10px] font-semibold text-ink-400">{day.grossPaise ? compactRupees(day.grossPaise) : ''}</span>
                    <div className="w-full rounded-t-lg bg-brand-500/90" style={{ height: `${Math.max(4, (day.grossPaise / peak) * 100)}px` }} />
                    <span className="text-[10.5px] font-semibold text-ink-500">
                      {new Date(`${day.day}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(invoices.data ?? []).length > 0 && (
            <div className="rounded-3xl bg-white p-5 ring-1 ring-ink-200">
              <p className="eyebrow text-ink-400">Commission invoices</p>
              <p className="mt-1 text-xs text-ink-500">Monthly, for your GST input credit. Already deducted from payouts.</p>
              <InvoiceList invoices={invoices.data!} pdfPath={(invoice) => `/partner/r/${id}/invoices/${invoice.id}/pdf`} />
            </div>
          )}

          {(payouts.data?.settlements ?? []).length > 0 && (
            <div className="rounded-3xl bg-white p-5 ring-1 ring-ink-200">
              <p className="eyebrow text-ink-400">Settlements</p>
              <ul className="mt-2 divide-y divide-ink-100">
                {payouts.data!.settlements.map((s) => (
                  <li key={s.reference} className="flex items-center justify-between py-2.5 text-sm">
                    <span>
                      <span className="block font-semibold">{s.reference}</span>
                      <span className="text-xs text-ink-500">{dateTime(s.createdAt)}{s.utr ? ` · UTR ${s.utr}` : ''}</span>
                    </span>
                    <span className="num font-bold">{rupees(s.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-3xl bg-white p-5 ring-1 ring-ink-200">
          <p className="eyebrow text-ink-400">Recent activity</p>
          {payouts.isLoading ? (
            <Skeleton className="mt-3 h-64" />
          ) : (
            <ul className="mt-2 divide-y divide-ink-100">
              {(payouts.data?.movements ?? []).map((movement, index) => {
                const credit = movement.amountPaise >= 0;
                return (
                  <li key={index} className="flex items-center gap-3 py-3">
                    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', credit ? 'bg-save-50 text-save-600' : 'bg-ink-100 text-ink-600')}>
                      {credit ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{MOVEMENT_LABEL[movement.kind] ?? movement.kind.replace(/_/g, ' ')}</span>
                      <span className="block truncate text-xs text-ink-500">{movement.memo?.split(' via ')[0]} · {dateTime(movement.occurredAt)}</span>
                    </span>
                    <span className={cn('num text-sm font-bold', credit ? 'text-save-700' : 'text-ink-700')}>
                      {credit ? '+' : '−'}
                      {rupees(Math.abs(movement.amountPaise))}
                    </span>
                  </li>
                );
              })}
              {(payouts.data?.movements ?? []).length === 0 && <li className="py-8 text-center text-sm text-ink-500">No activity yet.</li>}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
