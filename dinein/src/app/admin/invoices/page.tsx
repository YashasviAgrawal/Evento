'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { ApiError, api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { CommissionInvoice } from '@/lib/types';
import { rupees } from '@/lib/format';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { InvoiceList, periodLabel } from '@/components/finance/invoice-list';

/** Last month in IST, as YYYY-MM. */
function lastMonth(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Monthly commission invoices. They are issued automatically in the first
 * days of each month; this page shows them and can issue a month by hand
 * (for example after a restaurant's GSTIN arrives late — already-issued
 * invoices are never changed).
 */
export default function AdminInvoicesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(lastMonth);

  const invoices = useQuery({
    queryKey: ['admin-invoices', month],
    queryFn: async () => (await api.get<{ month: string; invoices: CommissionInvoice[] }>('/admin/dining/invoices', { query: { month } })).data,
  });

  const generate = useMutation({
    mutationFn: async () => (await api.post<{ issued: number; skipped: number }>('/admin/dining/invoices/generate', { month })).data,
    onSuccess: (result) => {
      toast.success(result.issued ? `${result.issued} invoice${result.issued > 1 ? 's' : ''} issued` : 'Nothing new to invoice');
      void queryClient.invalidateQueries({ queryKey: ['admin-invoices', month] });
    },
    onError: (error) => toast.error('Could not issue invoices', error instanceof ApiError ? error.message : undefined),
  });

  const list = invoices.data?.invoices ?? [];
  const sum = (key: 'taxablePaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'totalPaise') => list.reduce((total, i) => total + i[key], 0);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Commission invoices</h1>
          <p className="text-sm text-ink-500">One per restaurant per month, issued automatically after the month closes.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="month">Month</label>
            <input id="month" type="month" className="input" value={month} max={lastMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="press h-12 rounded-xl bg-ink-900 px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            {generate.isPending ? 'Issuing…' : 'Issue missing'}
          </button>
        </div>
      </div>

      {list.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['Invoices', String(list.length)],
              ['Commission', rupees(sum('taxablePaise'), { decimals: true })],
              ['GST', rupees(sum('cgstPaise') + sum('sgstPaise') + sum('igstPaise'), { decimals: true })],
              ['Invoiced total', rupees(sum('totalPaise'), { decimals: true })],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-white p-4 ring-1 ring-ink-200">
              <dt className="text-xs font-semibold text-ink-500">{label}</dt>
              <dd className="num mt-1 text-lg font-extrabold">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 rounded-3xl bg-white px-5 py-2 ring-1 ring-ink-200">
        {invoices.isLoading ? (
          <Skeleton className="my-3 h-40" />
        ) : list.length === 0 ? (
          <EmptyState icon={FileText} title={`No invoices for ${periodLabel(`${month}-01`)}`} body="Issue them once the month has closed and restaurants have earned commission." />
        ) : (
          <InvoiceList invoices={list} showRestaurant pdfPath={(invoice) => `/admin/dining/invoices/${invoice.id}/pdf`} />
        )}
      </div>
    </div>
  );
}
