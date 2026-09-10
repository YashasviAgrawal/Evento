'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  IndianRupee,
  Percent,
  RotateCcw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { OrganizerAnalyticsResponse, OrganizerAnalyticsRow } from '@/lib/types';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { BarList } from '@/components/dashboard/charts';
import { Button } from '@/components/ui/button';
import { EmptyState, Input, Skeleton, StatusBadge } from '@/components/ui/index';
import { cn, formatDateTime, formatMoney, formatNumber } from '@/lib/format';

type SortKey = 'revenue' | 'commission' | 'tickets' | 'events' | 'attendance' | 'newest' | 'name';

const TABS = [
  { key: '', label: 'All' },
  { key: 'verified', label: 'Verified' },
  { key: 'pending', label: 'Pending' },
  { key: 'suspended', label: 'Suspended' },
];

export default function AdminOrganizerAnalyticsPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState<SortKey>('revenue');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OrganizerAnalyticsResponse | null>(null);
  const [top, setTop] = useState<OrganizerAnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<OrganizerAnalyticsResponse>('/admin/organizers/analytics', {
        query: { status: status || undefined, q: debounced || undefined, sort, page, limit: 20 },
      });
      setData(response.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [status, debounced, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // The revenue chart always shows the platform's best organizers, so it stays
  // meaningful while the table below is filtered, searched or re-sorted.
  useEffect(() => {
    api
      .get<OrganizerAnalyticsResponse>('/admin/organizers/analytics', { query: { sort: 'revenue', limit: 8 } })
      .then((response) => setTop(response.data.organizers.filter((row) => row.grossRevenuePaise > 0)))
      .catch(() => setTop([]));
  }, []);

  function toggleSort(key: SortKey) {
    setSort(key);
    setPage(1);
  }

  const totals = data?.totals;
  const organizers = data?.organizers ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizer analytics"
        description="Sales, payouts and event performance for every organizer on the platform"
      />

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : totals ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Organizers"
            value={formatNumber(totals.organizers)}
            hint={`${formatNumber(totals.verified)} verified · ${formatNumber(totals.pending)} pending`}
            icon={<ShieldCheck className="h-4 w-4" />}
          />
          <StatCard
            label="Selling organizers"
            value={formatNumber(totals.selling)}
            hint={
              totals.organizers > 0
                ? `${Math.round((totals.selling / totals.organizers) * 100)}% have made a sale`
                : 'No organizers yet'
            }
            tone="brand"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <StatCard
            label="Gross sales"
            value={formatMoney(totals.grossRevenuePaise, { compact: true })}
            hint={`${formatNumber(totals.ticketsSold)} tickets sold`}
            icon={<IndianRupee className="h-4 w-4" />}
          />
          <StatCard
            label="Platform commission"
            value={formatMoney(totals.commissionPaise, { compact: true })}
            hint="Earned from these organizers"
            tone="success"
            icon={<Percent className="h-4 w-4" />}
          />
          <StatCard
            label="Organizer payouts"
            value={formatMoney(totals.payoutPaise, { compact: true })}
            hint="Owed to / settled with organizers"
            icon={<Wallet className="h-4 w-4" />}
          />
          <StatCard
            label="Refunded"
            value={formatMoney(totals.refundedPaise, { compact: true })}
            hint="Returned to customers"
            tone={totals.refundedPaise > 0 ? 'warning' : 'default'}
            icon={<RotateCcw className="h-4 w-4" />}
          />
        </div>
      ) : (
        <p className="text-sm text-ink-500">Could not load organizer analytics.</p>
      )}

      {top.length > 0 && (
        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-base font-bold text-ink-900">Top organizers by revenue</h2>
          <p className="mt-0.5 text-xs text-ink-500">Gross booking value across all their events</p>
          <div className="mt-4">
            <BarList
              items={top.map((row) => ({ label: row.displayName, value: row.grossRevenuePaise }))}
              format={(value) => formatMoney(value, { compact: true })}
            />
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setStatus(tab.key);
                setPage(1);
              }}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition',
                status === tab.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organizers"
            className="pl-9"
            aria-label="Search organizers"
          />
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : organizers.length === 0 ? (
        <EmptyState
          icon={<TrendingUp className="h-9 w-9" />}
          title="No organizers match this view"
          description="Try a different status filter or search term."
        />
      ) : (
        <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <SortHeader label="Organizer" sortKey="name" sort={sort} onSort={toggleSort} />
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <SortHeader label="Events" sortKey="events" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="Tickets" sortKey="tickets" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="Attendance" sortKey="attendance" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="Gross sales" sortKey="revenue" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="Commission" sortKey="commission" sort={sort} onSort={toggleSort} align="right" />
                  <th className="px-4 py-3 text-right font-semibold">Payout</th>
                  <th className="px-4 py-3 text-right font-semibold">Refunded</th>
                  <th className="px-4 py-3 text-right font-semibold">Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {organizers.map((row) => (
                  <tr key={row.id} className="transition hover:bg-ink-50">
                    <td className="px-4 py-3.5">
                      <Link href={`/admin/organizers/${row.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {row.displayName}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-ink-500">{row.contact.email}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink-700">
                      {formatNumber(row.totalEvents)}
                      <span className="block text-xs text-ink-400">{formatNumber(row.upcomingEvents)} upcoming</span>
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink-700">
                      {formatNumber(row.ticketsSold)}
                      <span className="block text-xs text-ink-400">{formatNumber(row.totalBookings)} bookings</span>
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink-700">
                      {row.ticketsIssued > 0 ? `${row.attendanceRate}%` : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-ink-900">
                      {formatMoney(row.grossRevenuePaise, { compact: true })}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-emerald-700">
                      {formatMoney(row.commissionPaise, { compact: true })}
                      <span className="block text-xs text-ink-400">
                        {row.commissionPercent === null ? 'default rate' : `${row.commissionPercent}%`}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink-700">
                      {formatMoney(row.payoutPaise, { compact: true })}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink-700">
                      {row.refundedPaise > 0 ? (
                        <span className="text-amber-700">{formatMoney(row.refundedPaise, { compact: true })}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Link
                        href={`/admin/organizers/${row.id}`}
                        className="text-xs font-semibold text-brand-600 hover:underline"
                      >
                        View
                      </Link>
                      <span className="block text-xs text-ink-400">
                        {row.lastBookingAt ? `Sale ${formatDateTime(row.lastBookingAt)}` : 'No sales yet'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-ink-500">
            Page {meta.page} of {meta.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort === sortKey;
  // Every metric sorts biggest-first; only the name column reads A→Z.
  const ascending = sortKey === 'name';
  return (
    <th
      className={cn('px-4 py-3 font-semibold', align === 'right' && 'text-right')}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-ink-900',
          align === 'right' && 'flex-row-reverse',
          active && 'text-ink-900',
        )}
      >
        {label}
        {active ? (
          ascending ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  );
}
