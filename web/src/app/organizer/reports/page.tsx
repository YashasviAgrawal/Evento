'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, IndianRupee, Percent, TicketCheck, Users } from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import type { EventPerformance, OrganizerSummary, SalesPoint } from '@/lib/types';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { AreaChart, BarList, RevenueChart } from '@/components/dashboard/charts';
import { Button } from '@/components/ui/button';
import { Select, Skeleton, StatusBadge } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatEventDate, formatMoney, formatNumber } from '@/lib/format';

interface ReportData {
  summary: OrganizerSummary;
  salesSeries: SalesPoint[];
  events: EventPerformance[];
}

export default function OrganizerReportsPage() {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ReportData>('/organizer/reports', { query: { days } });
      setData(data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadFile('/organizer/bookings/export', `tixit-report-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success('Report downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <Skeleton className="h-96 rounded-xl" />;
  if (!data) return <p className="text-sm text-ink-500">Could not load reports.</p>;

  const { summary, salesSeries, events } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Sales, revenue and attendance across your events"
        actions={
          <>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-10 w-auto" aria-label="Report period">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </Select>
            <Button variant="outline" onClick={exportCsv} loading={exporting}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total sales"
          value={formatMoney(summary.grossRevenuePaise, { compact: true })}
          hint="Gross booking value"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <StatCard
          label="Your payout"
          value={formatMoney(summary.netRevenuePaise, { compact: true })}
          hint={`After ${formatMoney(summary.commissionPaise, { compact: true })} commission`}
          tone="success"
          icon={<Percent className="h-4 w-4" />}
        />
        <StatCard
          label="Tickets sold"
          value={formatNumber(summary.ticketsSold)}
          hint={`${formatNumber(summary.totalBookings)} bookings`}
          icon={<TicketCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Attendance"
          value={`${summary.attendanceRate}%`}
          hint="Of tickets issued"
          tone="brand"
          icon={<Users className="h-4 w-4" />}
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

      <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
        <h2 className="text-base font-bold text-ink-900">Top events by revenue</h2>
        <div className="mt-4">
          <BarList
            items={events
              .filter((event) => event.revenuePaise > 0)
              .slice(0, 8)
              .map((event) => ({ label: event.title, value: event.revenuePaise }))}
            format={(value) => formatMoney(value, { compact: true })}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
        <div className="border-b border-ink-200 p-5">
          <h2 className="text-base font-bold text-ink-900">Event breakdown</h2>
          <p className="mt-0.5 text-xs text-ink-500">Sales and attendance per event</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Event</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Bookings</th>
                <th className="px-5 py-3 text-right font-semibold">Tickets</th>
                <th className="px-5 py-3 text-right font-semibold">Attendance</th>
                <th className="px-5 py-3 text-right font-semibold">Revenue</th>
                <th className="px-5 py-3 text-right font-semibold">Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {events.map((event) => (
                <tr key={event.id} className="transition hover:bg-ink-50">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-ink-900">{event.title}</p>
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
      </section>
    </div>
  );
}
