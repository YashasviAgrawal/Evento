'use client';

import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { downloadFile } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { CommissionInvoice } from '@/lib/types';
import { rupees } from '@/lib/format';
import { Spinner } from '@/components/ui/feedback';

export function periodLabel(periodStart: string): string {
  return new Date(`${periodStart}T12:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/**
 * Commission invoices with a PDF download each. `pdfPath` differs by who is
 * asking (partner routes are scoped to the outlet; admin sees all).
 */
export function InvoiceList({
  invoices,
  pdfPath,
  showRestaurant = false,
}: {
  invoices: CommissionInvoice[];
  pdfPath: (invoice: CommissionInvoice) => string;
  showRestaurant?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function download(invoice: CommissionInvoice) {
    setBusy(invoice.id);
    try {
      await downloadFile(pdfPath(invoice), `tixit-${invoice.number.replace('/', '-')}.pdf`);
    } catch (error) {
      toast.error('Could not download the invoice', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="divide-y divide-ink-100">
      {invoices.map((invoice) => {
        const tax = invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise;
        return (
          <li key={invoice.id} className="flex items-center gap-3 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600">
              <FileText className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {showRestaurant ? invoice.restaurant.name : periodLabel(invoice.periodStart)}
              </span>
              <span className="num block truncate text-xs text-ink-500">
                {invoice.number} · {rupees(invoice.taxablePaise, { decimals: true })} + {invoice.igstPaise ? 'IGST' : 'GST'}{' '}
                {rupees(tax, { decimals: true })}
                {invoice.kind === 'statement' && ' · statement'}
              </span>
            </span>
            <span className="num hidden text-sm font-bold sm:block">{rupees(invoice.totalPaise, { decimals: true })}</span>
            <button
              onClick={() => void download(invoice)}
              disabled={busy === invoice.id}
              className="press grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset ring-ink-200 hover:bg-ink-50 disabled:opacity-60"
              aria-label={`Download ${invoice.number}`}
            >
              {busy === invoice.id ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
