'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { IndianRupee, Percent, Search, ShieldAlert, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import type { AdminPayoutLedgerResponse, KycStatus, OrganizerLedgerRow } from '@/lib/types';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { EmptyState, Input, Select, Skeleton, StatusBadge } from '@/components/ui/index';
import { cn, formatDateTime, formatMoney, formatNumber } from '@/lib/format';

/**
 * The finance team's worklist: every organizer with what they have earned,
 * what has been sent and what is still owed, sorted by the balance so the
 * biggest debts surface first.
 */
export default function AdminPaymentsPage() {
  const [ledger, setLedger] = useState<AdminPayoutLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [kycStatus, setKycStatus] = useState<KycStatus | ''>('');
  const [owing, setOwing] = useState(false);
  const [sort, setSort] = useState('pending');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<AdminPayoutLedgerResponse>('/admin/payouts', {
        query: {
          q: q || undefined,
          kycStatus: kycStatus || undefined,
          owing: owing ? 'true' : undefined,
          sort,
          page,
          limit: 20,
        },
      });
      setLedger(data);
    } catch {
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }, [q, kycStatus, owing, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = ledger?.totals;

  return (
    <div>
      <PageHeader
        title="Organizer payments"
        description="Verification, earnings, payouts and outstanding balances across every organizer"
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Gross ticket sales"
          value={formatMoney(totals?.grossRevenuePaise ?? 0, { compact: true })}
          hint={`${formatNumber(totals?.organizers ?? 0)} organizers`}
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <StatCard
          label="Platform commission"
          value={formatMoney(totals?.commissionPaise ?? 0, { compact: true })}
          hint="Retained by Tixit"
          tone="success"
          icon={<Percent className="h-4 w-4" />}
        />
        <StatCard
          label="Paid out"
          value={formatMoney(totals?.paidPaise ?? 0, { compact: true })}
          hint={
            (totals?.inTransitPaise ?? 0) > 0
              ? `${formatMoney(totals!.inTransitPaise, { compact: true })} in transit`
              : 'Cleared transfers'
          }
          icon={<Wallet className="h-4 w-4" />}
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(totals?.pendingPaise ?? 0, { compact: true })}
          hint={`${formatNumber(totals?.kycMissing ?? 0)} without KYC · ${formatNumber(totals?.kycPending ?? 0)} awaiting review`}
          tone={(totals?.pendingPaise ?? 0) > 0 ? 'warning' : 'default'}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </div>

      <form
        className="mb-5 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQ(search.trim());
          setPage(1);
        }}
      >
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organizer or email…"
            className="pl-9"
            aria-label="Search organizers"
          />
        </div>

        <Select
          value={kycStatus}
          onChange={(e) => {
            setKycStatus(e.target.value as KycStatus | '');
            setPage(1);
          }}
          className="h-10 w-auto"
          aria-label="KYC status"
        >
          <option value="">All verification states</option>
          <option value="approved">Verified</option>
          <option value="pending">Awaiting review</option>
          <option value="rejected">Declined</option>
          <option value="not_submitted">No KYC submitted</option>
        </Select>

        <Select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
          className="h-10 w-auto"
          aria-label="Sort by"
        >
          <option value="pending">Most owed</option>
          <option value="revenue">Highest revenue</option>
          <option value="paid">Most paid out</option>
          <option value="name">Name</option>
        </Select>

        <Button
          type="button"
          variant={owing ? 'primary' : 'outline'}
          onClick={() => {
            setOwing((value) => !value);
            setPage(1);
          }}
        >
          Owed money only
        </Button>

        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {loading && !ledger ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : !ledger || ledger.organizers.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-9 w-9" />}
          title="No organizers match these filters"
          description="Try clearing the KYC filter or the outstanding-balance toggle."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-sm">
                <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Organizer</th>
                    <th className="px-5 py-3 font-semibold">Verification</th>
                    <th className="px-5 py-3 text-right font-semibold">Gross sales</th>
                    <th className="px-5 py-3 text-right font-semibold">Commission</th>
                    <th className="px-5 py-3 text-right font-semibold">Earned</th>
                    <th className="px-5 py-3 text-right font-semibold">Paid out</th>
                    <th className="px-5 py-3 text-right font-semibold">Outstanding</th>
                    <th className="px-5 py-3 text-right font-semibold">Last payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {ledger.organizers.map((row) => (
                    <LedgerRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {ledger.meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-ink-500">
                Page {ledger.meta.page} of {ledger.meta.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={!ledger.meta.hasNext} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LedgerRow({ row }: { row: OrganizerLedgerRow }) {
  return (
    <tr className="transition hover:bg-ink-50">
      <td className="px-5 py-3.5">
        <Link href={`/admin/payments/${row.id}`} className="font-medium text-ink-900 hover:text-brand-600">
          {row.displayName}
        </Link>
        <p className="mt-0.5 truncate text-xs text-ink-500">{row.contact.email}</p>
      </td>
      <td className="px-5 py-3.5">
        <StatusBadge status={row.kycStatus} />
      </td>
      <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">{formatMoney(row.grossRevenuePaise)}</td>
      <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">{formatMoney(row.commissionPaise)}</td>
      <td className="px-5 py-3.5 text-right tabular-nums text-ink-900">{formatMoney(row.earnedPaise)}</td>
      <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">
        {formatMoney(row.paidPaise)}
        {row.inTransitPaise > 0 && (
          <span className="block text-xs text-sky-600">+{formatMoney(row.inTransitPaise)} in transit</span>
        )}
      </td>
      <td
        className={cn(
          'px-5 py-3.5 text-right font-semibold tabular-nums',
          row.pendingPaise > 0 ? 'text-amber-700' : row.pendingPaise < 0 ? 'text-rose-700' : 'text-ink-500',
        )}
      >
        {formatMoney(row.pendingPaise)}
      </td>
      <td className="px-5 py-3.5 text-right text-xs text-ink-500">
        {row.lastPayoutAt ? formatDateTime(row.lastPayoutAt) : 'Never'}
      </td>
    </tr>
  );
}
