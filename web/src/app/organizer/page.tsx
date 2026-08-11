'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarCheck,
  IndianRupee,
  Plus,
  TicketCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { EventPerformance, OrganizerSummary, SalesPoint } from '@/lib/types';
import { useAuth } from '@/components/providers/auth-provider';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { RevenueChart } from '@/components/dashboard/charts';
import { ButtonLink } from '@/components/ui/button';
import { Alert, EmptyState, Skeleton, StatusBadge } from '@/components/ui/index';
import { formatEventDate, formatMoney, formatNumber } from '@/lib/format';

interface DashboardData {
  summary: OrganizerSummary;
  salesSeries: SalesPoint[];
  events: EventPerformance[];
}

export default function OrganizerDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<DashboardData>('/organizer/dashboard')
      .then((response) => setData(response.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        title="Could not load your dashboard"
        description="Check that the API is running and try again."
        action={<ButtonLink href="/organizer">Retry</ButtonLink>}
      />
    );
  }

  const { summary, salesSeries, events } = data;
  const pendingVerification = user?.organizer?.status === 'pending';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${user?.fullName.split(' ')[0] ?? 'there'}`}
        description="Here's how your events are performing"
        actions={
          <ButtonLink href="/organizer/events/new">
            <Plus className="h-4 w-4" />
            Create event
          </ButtonLink>
        }
      />

      {pendingVerification && (
        <Alert tone="warning" title="Your organizer account is awaiting verification">
          You can create and edit drafts now. Once our team verifies your account you&apos;ll be able to submit events
          for publishing.
        </Alert>
      )}

      {summary.pendingEvents > 0 && (
        <Alert tone="info">
          {summary.pendingEvents} {summary.pendingEvents === 1 ? 'event is' : 'events are'} awaiting admin approval.{' '}
          <Link href="/organizer/events?status=pending_review" className="font-semibold underline">
            View them
          </Link>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Net revenue"
          value={formatMoney(summary.netRevenuePaise, { compact: true })}
          hint={`${formatMoney(summary.grossRevenuePaise, { compact: true })} gross · ${formatMoney(summary.commissionPaise, { compact: true })} commission`}
          icon={<IndianRupee className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Tickets sold"
          value={formatNumber(summary.ticketsSold)}
          hint={`${formatNumber(summary.totalBookings)} bookings`}
          icon={<TicketCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Live events"
          value={summary.publishedEvents}
          hint={`${summary.upcomingEvents} upcoming · ${summary.totalEvents} total`}
          icon={<CalendarCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Attendance"
          value={`${summary.attendanceRate}%`}
          hint="Tickets scanned at the door"
          icon={<Users className="h-4 w-4" />}
          tone="brand"
        />
      </div>

      <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
              <TrendingUp className="h-4 w-4 text-brand-600" aria-hidden />
              Sales — last 30 days
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">Gross booking value per day</p>
          </div>
          <Link href="/organizer/reports" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Full report →
          </Link>
        </div>

        <RevenueChart
          data={salesSeries.map((point) => ({ date: point.date, value: point.revenuePaise }))}
          label="Daily gross revenue over the last 30 days"
        />
      </section>

      <section className="rounded-xl border border-ink-200 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-ink-200 p-5">
          <h2 className="text-base font-bold text-ink-900">Event performance</h2>
          <Link href="/organizer/events" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            All events →
          </Link>
        </div>

        {events.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<CalendarCheck className="h-9 w-9" />}
              title="No events yet"
              description="Create your first event and start selling tickets in minutes."
              action={
                <ButtonLink href="/organizer/events/new">
                  <Plus className="h-4 w-4" />
                  Create your first event
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Event</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Sold</th>
                  <th className="px-5 py-3 font-semibold">Sell-through</th>
                  <th className="px-5 py-3 text-right font-semibold">Checked in</th>
                  <th className="px-5 py-3 text-right font-semibold">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {events.map((event) => (
                  <tr key={event.id} className="transition hover:bg-ink-50">
                    <td className="px-5 py-3.5">
                      <Link href={`/organizer/events/${event.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {event.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-500">{formatEventDate(event.startsAt)}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={event.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">
                      {formatNumber(event.ticketsSold)}
                      <span className="text-ink-400"> / {formatNumber(event.capacity)}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100">
                          <div
                            className="h-full rounded-full bg-brand-600"
                            style={{ width: `${Math.min(100, event.sellThrough)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-ink-500">{event.sellThrough}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">{formatNumber(event.checkedIn)}</td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-ink-900">
                      {formatMoney(event.payoutPaise, { compact: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <QuickAction
          href="/organizer/events/new"
          icon={<Plus className="h-5 w-5" />}
          title="Create an event"
          description="Set up tiers and go live"
        />
        <QuickAction
          href="/organizer/scan"
          icon={<BadgeCheck className="h-5 w-5" />}
          title="Scan tickets"
          description="Check attendees in at the door"
        />
        <QuickAction
          href="/organizer/bookings"
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Manage bookings"
          description="Search attendees, export CSV"
        />
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-900">{title}</span>
        <span className="mt-0.5 block text-xs text-ink-500">{description}</span>
      </span>
    </Link>
  );
}
