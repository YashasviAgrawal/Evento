'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, Download, IndianRupee, Percent, RotateCcw, ShieldCheck, TicketCheck, Users } from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import type { AdminSummary, RevenuePoint } from '@/lib/types';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { AreaChart, BarList } from '@/components/dashboard/charts';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatEventDate, formatMoney, formatNumber } from '@/lib/format';

interface TopEvent {
  id: string;
  title: string;
  slug: string;
  startsAt: string;
  organizer: string;
  revenuePaise: number;
  tickets: number;
}

interface CategoryStat {
  name: string;
  slug: string;
  color: string;
  events: number;
  tickets: number;
  revenuePaise: number;
}

interface AdminDashboard {
  summary: AdminSummary;
  revenueSeries: RevenuePoint[];
  topEvents: TopEvent[];
  categories: CategoryStat[];
}

export default function AdminOverviewPage() {
  const toast = useToast();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api
      .get<AdminDashboard>('/admin/dashboard')
      .then((response) => setData(response.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  async function exportAll() {
    setExporting(true);
    try {
      await downloadFile('/admin/reports/export', `evento-platform-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success('Export downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return <p className="text-sm text-ink-500">Could not load the dashboard.</p>;

  const { summary, revenueSeries, topEvents, categories } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description="Revenue, growth and everything that needs your attention"
        actions={
          <Button variant="outline" onClick={exportAll} loading={exporting}>
            <Download className="h-4 w-4" />
            Export all bookings
          </Button>
        }
      />

      {(summary.pendingEvents > 0 || summary.pendingOrganizers > 0 || summary.pendingRefunds > 0) && (
        <Alert tone="warning" title="Awaiting your review">
          <ul className="mt-1 space-y-0.5">
            {summary.pendingEvents > 0 && (
              <li>
                <Link href="/admin/events?status=pending_review" className="font-semibold underline">
                  {summary.pendingEvents} {summary.pendingEvents === 1 ? 'event' : 'events'}
                </Link>{' '}
                pending approval
              </li>
            )}
            {summary.pendingOrganizers > 0 && (
              <li>
                <Link href="/admin/organizers?status=pending" className="font-semibold underline">
                  {summary.pendingOrganizers} {summary.pendingOrganizers === 1 ? 'organizer' : 'organizers'}
                </Link>{' '}
                awaiting verification
              </li>
            )}
            {summary.pendingRefunds > 0 && (
              <li>
                <Link href="/admin/refunds?status=requested" className="font-semibold underline">
                  {summary.pendingRefunds} refund {summary.pendingRefunds === 1 ? 'request' : 'requests'}
                </Link>{' '}
                to review
              </li>
            )}
          </ul>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total revenue"
          value={formatMoney(summary.grossRevenuePaise, { compact: true })}
          hint="Gross booking value"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <StatCard
          label="Commission earned"
          value={formatMoney(summary.commissionEarnedPaise, { compact: true })}
          hint="Platform revenue"
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
          label="Refunded"
          value={formatMoney(summary.refundedPaise, { compact: true })}
          hint={`${summary.pendingRefunds} pending`}
          tone={summary.pendingRefunds > 0 ? 'warning' : 'default'}
          icon={<RotateCcw className="h-4 w-4" />}
        />

        <StatCard
          label="Total users"
          value={formatNumber(summary.totalUsers)}
          hint={`+${formatNumber(summary.newUsersThisMonth)} this month`}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Customers"
          value={formatNumber(summary.totalCustomers)}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Organizers"
          value={formatNumber(summary.totalOrganizers)}
          hint={`${summary.pendingOrganizers} pending verification`}
          tone={summary.pendingOrganizers > 0 ? 'warning' : 'default'}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Events"
          value={formatNumber(summary.totalEvents)}
          hint={`${summary.publishedEvents} live · ${summary.pendingEvents} in review`}
          icon={<CalendarCheck className="h-4 w-4" />}
        />
      </div>

      <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
        <h2 className="text-base font-bold text-ink-900">Platform revenue — last 30 days</h2>
        <p className="mt-0.5 text-xs text-ink-500">Gross booking value per day</p>
        <div className="mt-4">
          <AreaChart
            data={revenueSeries.map((point) => ({ date: point.date, value: point.grossPaise }))}
            label="Daily gross revenue over the last 30 days"
            format={(value) => formatMoney(value, { compact: true })}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-base font-bold text-ink-900">Revenue by category</h2>
          <div className="mt-4">
            <BarList
              items={categories
                .filter((category) => category.revenuePaise > 0)
                .map((category) => ({
                  label: category.name,
                  value: category.revenuePaise,
                  color: category.color,
                }))}
              format={(value) => formatMoney(value, { compact: true })}
            />
          </div>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-base font-bold text-ink-900">Top events</h2>
          <p className="mt-0.5 text-xs text-ink-500">Highest grossing across the platform</p>

          {topEvents.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-400">No sales yet</p>
          ) : (
            <ul className="mt-4 divide-y divide-ink-100">
              {topEvents.map((event, index) => (
                <li key={event.id} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-100 text-xs font-bold text-ink-600">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/events/${event.slug}`} className="block truncate text-sm font-medium text-ink-900 hover:text-brand-600">
                      {event.title}
                    </Link>
                    <p className="truncate text-xs text-ink-500">
                      {event.organizer} · {formatEventDate(event.startsAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums text-ink-900">
                      {formatMoney(event.revenuePaise, { compact: true })}
                    </p>
                    <p className="text-xs text-ink-500">{formatNumber(event.tickets)} tickets</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
