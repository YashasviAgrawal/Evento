'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarCheck,
  Download,
  IndianRupee,
  Percent,
  RotateCcw,
  Tag,
  TicketCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { api, ApiError, downloadFile } from '@/lib/api';
import type { AdminOrganizerReport } from '@/lib/types';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { AreaChart, BarList, RevenueChart } from '@/components/dashboard/charts';
import { Button } from '@/components/ui/button';
import { Alert, DetailRow, Select, Skeleton, StatusBadge } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, formatEventDate, formatMoney, formatNumber } from '@/lib/format';

export default function AdminOrganizerReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();

  const [days, setDays] = useState(30);
  const [report, setReport] = useState<AdminOrganizerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<AdminOrganizerReport>(`/admin/organizers/${id}/analytics`, { query: { days } });
      setReport(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this organizer');
    } finally {
      setLoading(false);
    }
  }, [id, days]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportBookings() {
    setExporting(true);
    try {
      await downloadFile(
        `/admin/organizers/${id}/bookings/export`,
        `${report?.organizer.slug ?? 'organizer'}-bookings-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      toast.success('Export downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (loading && !report) return <Skeleton className="h-96 rounded-xl" />;
  if (error || !report) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert tone="error" title="Report unavailable">
          {error ?? 'Could not load this organizer.'}
        </Alert>
      </div>
    );
  }

  const { organizer, summary, salesSeries, events, categories, recentBookings, refunds, coupons } = report;

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={organizer.displayName}
        description={`${organizer.user.fullName} · ${organizer.user.email}${organizer.user.phone ? ` · ${organizer.user.phone}` : ''}`}
        actions={
          <>
            <Select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-10 w-auto"
              aria-label="Report period"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </Select>
            <Button variant="outline" onClick={exportBookings} loading={exporting}>
              <Download className="h-4 w-4" />
              Export bookings
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={organizer.status} />
        {organizer.user.status !== 'active' && <StatusBadge status={organizer.user.status} />}
        <span className="text-xs text-ink-500">
          Joined {formatDateTime(organizer.createdAt)}
          {organizer.verifiedAt && ` · Verified ${formatDateTime(organizer.verifiedAt)}`}
        </span>
      </div>

      {organizer.rejectionReason && (
        <Alert tone="warning" title="Last review note">
          {organizer.rejectionReason}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Gross sales"
          value={formatMoney(summary.grossRevenuePaise, { compact: true })}
          hint={`${formatNumber(summary.totalBookings)} bookings`}
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <StatCard
          label="Platform commission"
          value={formatMoney(summary.commissionPaise, { compact: true })}
          hint={organizer.commissionPercent === null ? 'Platform default rate' : `${organizer.commissionPercent}% custom rate`}
          tone="success"
          icon={<Percent className="h-4 w-4" />}
        />
        <StatCard
          label="Organizer payout"
          value={formatMoney(summary.netRevenuePaise, { compact: true })}
          hint="After commission and refunds"
          icon={<Wallet className="h-4 w-4" />}
        />
        <StatCard
          label="Refunded"
          value={formatMoney(summary.refundedPaise, { compact: true })}
          hint={`${formatNumber(refunds.total)} requests · ${formatNumber(refunds.pending)} pending`}
          tone={refunds.pending > 0 ? 'warning' : 'default'}
          icon={<RotateCcw className="h-4 w-4" />}
        />

        <StatCard
          label="Tickets sold"
          value={formatNumber(summary.ticketsSold)}
          icon={<TicketCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Attendance"
          value={`${summary.attendanceRate}%`}
          hint="Of tickets issued, checked in"
          tone="brand"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Events"
          value={formatNumber(summary.totalEvents)}
          hint={`${summary.publishedEvents} live · ${summary.pendingEvents} in review`}
          icon={<CalendarCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Discounts given"
          value={formatMoney(coupons.discountPaise, { compact: true })}
          hint={`${formatNumber(coupons.total)} own coupons · ${formatNumber(coupons.redemptions)} redemptions`}
          icon={<Tag className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-base font-bold text-ink-900">Revenue</h2>
          <p className="mt-0.5 text-xs text-ink-500">Gross booking value per day</p>
          <div className="mt-4">
            <RevenueChart
              data={salesSeries.map((point) => ({ date: point.date, value: point.revenuePaise }))}
              label={`Daily revenue over the last ${days} days`}
            />
          </div>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-base font-bold text-ink-900">Tickets sold</h2>
          <p className="mt-0.5 text-xs text-ink-500">Ticket volume per day</p>
          <div className="mt-4">
            <AreaChart
              data={salesSeries.map((point) => ({ date: point.date, value: point.tickets }))}
              label={`Daily tickets sold over the last ${days} days`}
              format={(value) => formatNumber(value)}
            />
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card lg:col-span-2">
          <h2 className="text-base font-bold text-ink-900">Revenue by category</h2>
          <p className="mt-0.5 text-xs text-ink-500">Where this organizer sells</p>
          <div className="mt-4">
            <BarList
              items={categories
                .filter((category) => category.revenuePaise > 0)
                .map((category) => ({ label: category.name, value: category.revenuePaise, color: category.color }))}
              format={(value) => formatMoney(value, { compact: true })}
            />
          </div>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-base font-bold text-ink-900">Account details</h2>
          <dl className="mt-2 divide-y divide-ink-100">
            <DetailRow label="Slug" value={organizer.slug} />
            <DetailRow label="City" value={organizer.city ?? '—'} />
            <DetailRow label="Website" value={organizer.website ?? '—'} />
            <DetailRow label="Support email" value={organizer.supportEmail ?? '—'} />
            <DetailRow label="Support phone" value={organizer.supportPhone ?? '—'} />
            <DetailRow label="GSTIN" value={organizer.gstin ?? '—'} />
            <DetailRow label="PAN" value={organizer.pan ?? '—'} />
            <DetailRow
              label="Commission"
              value={organizer.commissionPercent === null ? 'Platform default' : `${organizer.commissionPercent}%`}
            />
            <DetailRow
              label="Last login"
              value={organizer.user.lastLoginAt ? formatDateTime(organizer.user.lastLoginAt) : 'Never'}
            />
            <DetailRow
              label="Refunds"
              value={`${formatNumber(refunds.processed)} processed · ${formatMoney(refunds.amountPaise, { compact: true })}`}
            />
            <DetailRow
              label="Coupons"
              value={`${formatNumber(coupons.approved)} approved · ${formatNumber(coupons.pending)} pending`}
            />
          </dl>
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
        <div className="border-b border-ink-200 p-5">
          <h2 className="text-base font-bold text-ink-900">Event breakdown</h2>
          <p className="mt-0.5 text-xs text-ink-500">Every event this organizer has created</p>
        </div>

        {events.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">This organizer has not created an event yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Event</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Bookings</th>
                  <th className="px-5 py-3 text-right font-semibold">Tickets</th>
                  <th className="px-5 py-3 text-right font-semibold">Sell-through</th>
                  <th className="px-5 py-3 text-right font-semibold">Checked in</th>
                  <th className="px-5 py-3 text-right font-semibold">Revenue</th>
                  <th className="px-5 py-3 text-right font-semibold">Payout</th>
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
                    <td className="px-5 py-3.5">
                      <StatusBadge status={event.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">{formatNumber(event.bookings)}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">
                      {formatNumber(event.ticketsSold)}
                      <span className="text-ink-400"> / {formatNumber(event.capacity)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">{event.sellThrough}%</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">
                      {event.ticketsSold > 0 ? `${Math.round((event.checkedIn / event.ticketsSold) * 100)}%` : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-ink-900">
                      {formatMoney(event.revenuePaise)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-emerald-700">
                      {formatMoney(event.payoutPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
        <div className="border-b border-ink-200 p-5">
          <h2 className="text-base font-bold text-ink-900">Recent bookings</h2>
          <p className="mt-0.5 text-xs text-ink-500">The last 10 orders placed with this organizer</p>
        </div>

        {recentBookings.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">No bookings yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Booking</th>
                  <th className="px-5 py-3 font-semibold">Event</th>
                  <th className="px-5 py-3 font-semibold">Customer</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Qty</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {recentBookings.map((booking) => (
                  <tr key={booking.id} className="transition hover:bg-ink-50">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-ink-900">{booking.bookingCode}</p>
                      <p className="mt-0.5 text-xs text-ink-500">{formatDateTime(booking.createdAt)}</p>
                    </td>
                    <td className="px-5 py-3.5 text-ink-700">{booking.eventTitle}</td>
                    <td className="px-5 py-3.5">
                      <p className="text-ink-900">{booking.customerName}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">{booking.customerEmail}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={booking.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">{formatNumber(booking.quantity)}</td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-ink-900">
                      {formatMoney(booking.totalPaise)}
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

function BackLink() {
  return (
    <Link
      href="/admin/analytics"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to organizer analytics
    </Link>
  );
}
