'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  Download,
  IndianRupee,
  Landmark,
  Percent,
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { api, ApiError, downloadFile } from '@/lib/api';
import type { AdminOrganizerPayments, PayoutRecord } from '@/lib/types';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, DetailRow, Field, Input, Select, Skeleton, StatusBadge, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { cn, formatDateTime, formatEventDate, formatMoney, formatNumber } from '@/lib/format';

/**
 * Everything about one organizer's money: their verified payout details, the
 * running balance, the ledger of transfers made so far, and the form that adds
 * the next one.
 */
export default function AdminOrganizerPaymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();

  const [data, setData] = useState<AdminOrganizerPayments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: payload } = await api.get<AdminOrganizerPayments>(`/admin/organizers/${id}/payments`, {
        query: { limit: 50 },
      });
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this organizer');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Approving the KYC *is* verifying the organizer — one decision, so this
   * posts to the organizer status endpoint rather than a KYC-only one.
   */
  async function reviewKyc(decision: 'verified' | 'rejected' | 'pending', reason?: string) {
    setBusy(true);
    try {
      await api.post(`/admin/organizers/${id}/status`, { status: decision, reason });
      toast.success(
        decision === 'verified'
          ? 'Organizer verified — they can publish events and be paid'
          : decision === 'rejected'
            ? 'Declined, and the organizer has been told why'
            : 'Reopened — the organizer can edit and resubmit',
      );
      await load();
    } catch (err) {
      toast.error('Could not complete that review', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function removePayout(payout: PayoutRecord) {
    if (!window.confirm(`Delete payout ${payout.reference}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/admin/payouts/${payout.id}`);
      toast.success(`Payout ${payout.reference} deleted`);
      await load();
    } catch (err) {
      toast.error('Could not delete that payout', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(payout: PayoutRecord) {
    setBusy(true);
    try {
      await api.patch(`/admin/payouts/${payout.id}`, { status: 'paid' });
      toast.success(`${payout.reference} marked as paid`);
      await load();
    } catch (err) {
      toast.error('Could not update that payout', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function exportLedger() {
    setExporting(true);
    try {
      await downloadFile(
        `/admin/organizers/${id}/payouts/export`,
        `${data?.organizer.slug ?? 'organizer'}-payouts-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      toast.success('Ledger downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (loading && !data) return <Skeleton className="h-96 rounded-xl" />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert tone="error" title="Payments unavailable">
          {error ?? 'Could not load this organizer.'}
        </Alert>
      </div>
    );
  }

  const { organizer, kyc, summary, payouts, events } = data;

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={organizer.displayName}
        description={`${organizer.user.fullName} · ${organizer.user.email}${organizer.user.phone ? ` · ${organizer.user.phone}` : ''}`}
        actions={
          <>
            <Button variant="outline" onClick={exportLedger} loading={exporting}>
              <Download className="h-4 w-4" />
              Export ledger
            </Button>
            <Button onClick={() => setRecording((open) => !open)} disabled={!kyc.payoutsEnabled}>
              <Plus className="h-4 w-4" />
              Record payout
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={organizer.status} />
        <span className="text-xs text-ink-500">
          Joined {formatDateTime(organizer.createdAt)} ·{' '}
          {organizer.commissionPercent === null
            ? 'Platform default commission'
            : `${organizer.commissionPercent}% commission`}{' '}
          ·{' '}
          <Link href={`/admin/organizers/${organizer.id}`} className="font-medium underline hover:text-ink-700">
            Full report
          </Link>
        </span>
      </div>

      {!kyc.payoutsEnabled && (
        <Alert
          tone={kyc.status === 'pending' ? 'warning' : 'error'}
          title={
            kyc.status === 'not_submitted'
              ? 'No KYC submitted'
              : kyc.status === 'pending'
                ? 'KYC is awaiting your review'
                : 'This organizer was declined'
          }
        >
          {kyc.status === 'not_submitted'
            ? 'This organizer has not submitted their KYC, so there is nothing to verify and no account to pay into.'
            : kyc.status === 'pending'
              ? 'Approving the KYC below verifies the account — it is the same decision — and unlocks payouts.'
              : 'They need to correct their KYC and submit it again before the account can be verified.'}
        </Alert>
      )}

      {/* ── the balance ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Gross ticket sales"
          value={formatMoney(summary.grossRevenuePaise, { compact: true })}
          hint={`${formatNumber(summary.totalBookings)} bookings · ${formatNumber(summary.ticketsSold)} tickets`}
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <StatCard
          label="Platform commission"
          value={formatMoney(summary.commissionPaise, { compact: true })}
          hint="Retained by Tixit"
          tone="success"
          icon={<Percent className="h-4 w-4" />}
        />
        <StatCard
          label="Total paid out"
          value={formatMoney(summary.paidPaise, { compact: true })}
          hint={
            summary.lastPayoutAt ? `Last on ${formatDateTime(summary.lastPayoutAt)}` : 'No payout recorded yet'
          }
          icon={<Wallet className="h-4 w-4" />}
        />
        <StatCard
          label="Pending payout"
          value={formatMoney(summary.pendingPaise, { compact: true })}
          hint={
            summary.inTransitPaise > 0
              ? `${formatMoney(summary.inTransitPaise, { compact: true })} already in transit`
              : summary.pendingPaise < 0
                ? 'Overpaid — recover on the next settlement'
                : 'Owed to this organizer'
          }
          tone={summary.pendingPaise > 0 ? 'warning' : 'default'}
          icon={<Receipt className="h-4 w-4" />}
        />
      </div>

      <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
        <h2 className="text-base font-bold text-ink-900">How the balance is worked out</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Confirmed bookings only. GST and the convenience fee are collected by the platform and never form part of an
          organizer&rsquo;s payout.
        </p>
        <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
          <DetailRow label="Gross collected from customers" value={formatMoney(summary.grossRevenuePaise)} />
          <DetailRow label="GST collected (remitted by Tixit)" value={`− ${formatMoney(summary.taxPaise)}`} />
          <DetailRow label="Convenience fee (Tixit)" value={`− ${formatMoney(summary.convenienceFeePaise)}`} />
          <DetailRow label="Platform commission" value={`− ${formatMoney(summary.commissionPaise)}`} />
          <DetailRow label="Refunded to customers" value={`− ${formatMoney(summary.refundedPaise)}`} />
          <DetailRow label="Organizer earnings" value={formatMoney(summary.earnedPaise)} />
          <DetailRow label="Already paid out" value={`− ${formatMoney(summary.paidPaise)}`} />
          <DetailRow label="In transit" value={`− ${formatMoney(summary.inTransitPaise)}`} />
          <DetailRow
            label="TDS withheld to date"
            value={formatMoney(summary.tdsPaise)}
          />
          <DetailRow label="Transfer charges to date" value={formatMoney(summary.feePaise)} />
        </dl>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-ink-50 px-4 py-3">
          <span className="text-sm font-semibold text-ink-800">Outstanding balance</span>
          <span
            className={cn(
              'text-lg font-extrabold tabular-nums',
              summary.pendingPaise > 0 ? 'text-amber-700' : summary.pendingPaise < 0 ? 'text-rose-700' : 'text-ink-900',
            )}
          >
            {formatMoney(summary.pendingPaise, { withDecimals: true })}
          </span>
        </div>
      </section>

      {recording && kyc.payoutsEnabled && (
        <RecordPayoutForm
          organizerId={id}
          suggestedAmount={Math.max(0, summary.pendingPaise) / 100}
          onCancel={() => setRecording(false)}
          onSaved={async () => {
            setRecording(false);
            await load();
          }}
        />
      )}

      {/* ── KYC ── */}
      <KycPanel kyc={kyc} busy={busy} onReview={reviewKyc} />

      {/* ── the ledger ── */}
      <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 p-5">
          <div>
            <h2 className="text-base font-bold text-ink-900">Payout transactions</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              {formatNumber(summary.payoutCount)} recorded · every transfer entered by the finance team
            </p>
          </div>
        </div>

        {payouts.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">No payout has been recorded for this organizer yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Reference</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Method / UTR</th>
                  <th className="px-5 py-3 font-semibold">Period</th>
                  <th className="px-5 py-3 text-right font-semibold">Amount</th>
                  <th className="px-5 py-3 text-right font-semibold">TDS</th>
                  <th className="px-5 py-3 text-right font-semibold">Charges</th>
                  <th className="px-5 py-3 text-right font-semibold">Transferred</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {payouts.map((payout) => (
                  <tr key={payout.id} className="align-top transition hover:bg-ink-50">
                    <td className="px-5 py-3.5">
                      <p className="font-mono text-xs font-semibold text-ink-900">{payout.reference}</p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {payout.paidAt ? formatDateTime(payout.paidAt) : `Recorded ${formatDateTime(payout.createdAt)}`}
                      </p>
                      {payout.createdBy && <p className="text-xs text-ink-400">by {payout.createdBy.fullName}</p>}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={payout.status} />
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="capitalize text-ink-700">{payout.method.replace(/_/g, ' ')}</p>
                      {payout.utr && <p className="mt-0.5 font-mono text-xs text-ink-500">{payout.utr}</p>}
                      {payout.destination && <p className="mt-0.5 text-xs text-ink-400">{payout.destination}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-ink-500">
                      {payout.periodStart || payout.periodEnd
                        ? `${payout.periodStart ?? '…'} → ${payout.periodEnd ?? '…'}`
                        : '—'}
                      {payout.notes && <p className="mt-1 max-w-[220px] text-ink-600">{payout.notes}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-900">
                      {formatMoney(payout.amountPaise)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-600">
                      {payout.tdsPaise > 0 ? formatMoney(payout.tdsPaise) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-600">
                      {payout.feePaise > 0 ? formatMoney(payout.feePaise) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-emerald-700">
                      {formatMoney(payout.netPaise)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1.5">
                        {payout.status !== 'paid' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => markPaid(payout)}
                            title="Mark as paid"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:bg-rose-50"
                          disabled={busy}
                          onClick={() => removePayout(payout)}
                          title="Delete this entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── what the money came from ── */}
      <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
        <div className="border-b border-ink-200 p-5">
          <h2 className="text-base font-bold text-ink-900">Earnings by event</h2>
          <p className="mt-0.5 text-xs text-ink-500">What the outstanding balance is made of</p>
        </div>

        {events.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">This organizer has not sold a ticket yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Event</th>
                  <th className="px-5 py-3 text-right font-semibold">Tickets</th>
                  <th className="px-5 py-3 text-right font-semibold">Gross</th>
                  <th className="px-5 py-3 text-right font-semibold">GST</th>
                  <th className="px-5 py-3 text-right font-semibold">Commission</th>
                  <th className="px-5 py-3 text-right font-semibold">Refunded</th>
                  <th className="px-5 py-3 text-right font-semibold">Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {events.map((event) => (
                  <tr key={event.id} className="transition hover:bg-ink-50">
                    <td className="px-5 py-3.5">
                      <Link href={`/events/${event.slug}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {event.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-500">{formatEventDate(event.startsAt)}</p>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">{formatNumber(event.tickets)}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">
                      {formatMoney(event.grossRevenuePaise)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-600">{formatMoney(event.taxPaise)}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-600">
                      {formatMoney(event.commissionPaise)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-600">
                      {event.refundedPaise > 0 ? formatMoney(event.refundedPaise) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-ink-900">
                      {formatMoney(event.earnedPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────── KYC panel ─────────────────────── */

function KycPanel({
  kyc,
  busy,
  onReview,
}: {
  kyc: AdminOrganizerPayments['kyc'];
  busy: boolean;
  onReview: (decision: 'verified' | 'rejected' | 'pending', reason?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (!kyc.kyc) {
    return (
      <section className="rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center shadow-card">
        <Landmark className="mx-auto h-8 w-8 text-ink-300" />
        <p className="mt-3 text-sm font-semibold text-ink-800">No KYC submitted</p>
        <p className="mt-1 text-sm text-ink-500">
          This organizer has not yet provided their PAN, business details or bank account, so there is nothing to
          verify them on.
        </p>
      </section>
    );
  }

  const record = kyc.kyc;

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink-900">KYC submission</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Submitted {formatDateTime(record.submittedAt)}
            {kyc.verifiedAt && kyc.reviewedBy
              ? ` · verified by ${kyc.reviewedBy.fullName} on ${formatDateTime(kyc.verifiedAt)}`
              : ''}
            {' · '}
            Approving this verifies the organizer account.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {kyc.status !== 'approved' && (
            <Button variant="success" size="sm" disabled={busy} onClick={() => onReview('verified')}>
              <BadgeCheck className="h-3.5 w-3.5" />
              Approve &amp; verify
            </Button>
          )}
          {kyc.status !== 'rejected' && (
            <Button
              variant="outline"
              size="sm"
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
              disabled={busy}
              onClick={() => setRejecting((open) => !open)}
            >
              <X className="h-3.5 w-3.5" />
              Decline
            </Button>
          )}
          {kyc.status === 'approved' && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onReview('pending')}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reopen for editing
            </Button>
          )}
        </div>
      </div>

      {kyc.rejectionReason && kyc.status === 'rejected' && (
        <Alert tone="error" title="Declined" className="mb-4">
          {kyc.rejectionReason}
        </Alert>
      )}

      {rejecting && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <Field
            label="What needs fixing?"
            hint="Emailed to the organizer so they can correct their KYC and submit it again."
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              autoFocus
              placeholder="The account holder name does not match the PAN submitted."
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={busy || reason.trim().length < 5}
              onClick={() => {
                onReview('rejected', reason.trim());
                setRejecting(false);
                setReason('');
              }}
            >
              Decline this organizer
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-x-8 lg:grid-cols-2">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <Building2 className="h-3.5 w-3.5" />
            Identity &amp; business
          </p>
          <dl className="divide-y divide-ink-100">
            <DetailRow label="Name (as on PAN)" value={record.legalName} />
            <DetailRow label="PAN" value={<span className="font-mono">{record.pan}</span>} />
            <DetailRow label="Business name" value={record.businessName} />
            <DetailRow
              label="GSTIN"
              value={record.gstin ? <span className="font-mono">{record.gstin}</span> : 'Not registered'}
            />
            <DetailRow
              label="Business address"
              value={<span className="whitespace-pre-line">{record.businessAddress}</span>}
            />
          </dl>
        </div>

        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <Landmark className="h-3.5 w-3.5" />
            Bank account
          </p>
          <dl className="divide-y divide-ink-100">
            <DetailRow label="Account holder" value={record.accountHolderName} />
            <DetailRow label="Account number" value={<span className="font-mono">{record.accountNumber}</span>} />
            <DetailRow label="IFSC" value={<span className="font-mono">{record.ifsc}</span>} />
            <DetailRow label="Bank" value={record.bankName ?? '—'} />
          </dl>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── record a payout ─────────────────────── */

const METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer (NEFT/IMPS/RTGS)' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

function RecordPayoutForm({
  organizerId,
  suggestedAmount,
  onCancel,
  onSaved,
}: {
  organizerId: string;
  suggestedAmount: number;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    amount: suggestedAmount > 0 ? String(Math.round(suggestedAmount * 100) / 100) : '',
    tds: '',
    fee: '',
    method: 'bank_transfer',
    status: 'paid',
    utr: '',
    periodStart: '',
    periodEnd: '',
    notes: '',
  });

  const amount = Number(form.amount) || 0;
  const tds = Number(form.tds) || 0;
  const fee = Number(form.fee) || 0;
  const net = amount - tds - fee;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (amount <= 0) {
      toast.error('Enter the amount paid');
      return;
    }
    if (tds + fee > amount) {
      toast.error('TDS and charges cannot exceed the payout amount');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/admin/organizers/${organizerId}/payouts`, {
        amount,
        tds,
        fee,
        method: form.method,
        status: form.status,
        utr: form.utr.trim() || null,
        periodStart: form.periodStart || null,
        periodEnd: form.periodEnd || null,
        notes: form.notes.trim() || null,
      });
      toast.success('Payout recorded', 'The balance has been updated.');
      await onSaved();
    } catch (err) {
      toast.error('Could not record that payout', err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-brand-200 bg-brand-50/40 p-5 shadow-card">
      <h2 className="text-base font-bold text-ink-900">Record a payout</h2>
      <p className="mt-0.5 text-xs text-ink-500">
        Enter the transfer you have made (or are about to make). This is a record of a manual payment — nothing is sent
        to a bank from here.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Amount (₹)" required hint="The gross payout before any deduction">
          <Input
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
          />
        </Field>

        <Field label="TDS deducted (₹)" hint="Tax withheld at source, if any">
          <Input
            value={form.tds}
            onChange={(e) => setForm({ ...form, tds: e.target.value })}
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>

        <Field label="Transfer charges (₹)" hint="Bank or gateway fee, if any">
          <Input
            value={form.fee}
            onChange={(e) => setForm({ ...form, fee: e.target.value })}
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>

        <Field label="Method">
          <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status" hint="Pending and processing count against the balance too">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="paid">Paid</option>
            <option value="processing">Processing</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>

        <Field label="UTR / reference" hint="The bank's transaction reference">
          <Input
            value={form.utr}
            onChange={(e) => setForm({ ...form, utr: e.target.value })}
            placeholder="N123456789012345"
            className="font-mono"
          />
        </Field>

        <Field label="Period from" hint="Optional — the settlement window">
          <Input
            type="date"
            value={form.periodStart}
            onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
          />
        </Field>

        <Field label="Period to">
          <Input
            type="date"
            value={form.periodEnd}
            onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
          />
        </Field>

        <Field label="Notes" className="sm:col-span-2 lg:col-span-1">
          <Input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="August settlement"
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-4 py-3">
        <span className="text-sm text-ink-600">Net transferred to the organizer</span>
        <span className={cn('text-lg font-extrabold tabular-nums', net < 0 ? 'text-rose-600' : 'text-ink-900')}>
          {formatMoney(Math.round(net * 100), { withDecimals: true })}
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <Button type="submit" loading={saving}>
          Save payout
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/payments"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to organizer payments
    </Link>
  );
}
