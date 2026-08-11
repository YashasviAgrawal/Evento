'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  Eye,
  MapPin,
  Pause,
  Pencil,
  Play,
  Plus,
  QrCode,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { EventDetail, TicketType } from '@/lib/types';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Field, Input, Select, Skeleton, StatusBadge } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatEventDateTime, formatMoney, formatNumber } from '@/lib/format';

const TICKET_KINDS = ['regular', 'vip', 'early_bird', 'couple_pass', 'group_pass'];

export default function ManageEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [checkIn, setCheckIn] = useState<{ total: number; checkedIn: number; remaining: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingTier, setAddingTier] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, stats] = await Promise.all([
        api.get<EventDetail>(`/organizer/events/${id}`),
        api
          .get<{ total: number; checkedIn: number; remaining: number }>(`/organizer/events/${id}/checkin-stats`)
          .catch(() => ({ data: null })),
      ]);
      setEvent(detail.data);
      setCheckIn(stats.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this event');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: 'submit' | 'pause' | 'resume') {
    setBusy(true);
    try {
      await api.post(`/organizer/events/${id}/${action}`);
      toast.success(
        action === 'submit' ? 'Submitted for review' : action === 'pause' ? 'Bookings paused' : 'Bookings resumed',
      );
      await load();
    } catch (err) {
      toast.error('Could not complete that', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTier(tierId: string) {
    if (!window.confirm('Delete this ticket type?')) return;
    try {
      await api.delete(`/organizer/events/${id}/ticket-types/${tierId}`);
      toast.success('Ticket type deleted');
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function toggleTier(tier: TicketType) {
    try {
      await api.patch(`/organizer/events/${id}/ticket-types/${tier.id}`, { isActive: !tier.isActive });
      await load();
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    }
  }

  if (loading) return <Skeleton className="h-96 rounded-xl" />;

  if (error || !event) {
    return <Alert tone="error" title="Event unavailable">{error ?? 'Not found'}</Alert>;
  }

  const sold = event.ticketsSold;
  const capacity = event.totalCapacity;

  return (
    <div className="space-y-6">
      <Link
        href="/organizer/events"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to events
      </Link>

      <PageHeader
        title={event.title}
        description={`${formatEventDateTime(event.startsAt)} · ${event.venue.name}, ${event.city.name}`}
        actions={
          <>
            <ButtonLink href={`/events/${event.slug}`} variant="outline" size="sm" target="_blank">
              <Eye className="h-4 w-4" />
              Preview
            </ButtonLink>
            <ButtonLink href={`/organizer/events/${id}/edit`} variant="outline" size="sm">
              <Pencil className="h-4 w-4" />
              Edit
            </ButtonLink>
            {(event.status === 'draft' || event.status === 'rejected') && (
              <Button size="sm" onClick={() => act('submit')} loading={busy}>
                <Send className="h-4 w-4" />
                Submit for review
              </Button>
            )}
            {event.status === 'published' && (
              <Button variant="outline" size="sm" onClick={() => act('pause')} loading={busy}>
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            )}
            {event.status === 'paused' && (
              <Button size="sm" onClick={() => act('resume')} loading={busy}>
                <Play className="h-4 w-4" />
                Resume
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={event.status} />
        {event.isFeatured && <span className="badge bg-brand-50 text-brand-700 ring-brand-200">Featured</span>}
      </div>

      {event.status === 'rejected' && event.rejectionReason && (
        <Alert tone="error" title="Changes requested by our review team">
          {event.rejectionReason}
        </Alert>
      )}

      {event.status === 'pending_review' && (
        <Alert tone="info" title="Awaiting review">
          Our team is reviewing this event. You&apos;ll get an email as soon as it&apos;s approved.
        </Alert>
      )}

      {event.status === 'draft' && (
        <Alert tone="warning" title="This event is a draft">
          It is not visible to customers. Add your ticket types, then submit it for review.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tickets sold"
          value={`${formatNumber(sold)} / ${formatNumber(capacity)}`}
          hint={capacity > 0 ? `${Math.round((sold / capacity) * 100)}% sell-through` : undefined}
        />
        <StatCard label="Checked in" value={formatNumber(checkIn?.checkedIn ?? 0)} hint={`${formatNumber(checkIn?.remaining ?? 0)} yet to arrive`} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Page views" value={formatNumber(event.viewCount)} icon={<Eye className="h-4 w-4" />} />
        <StatCard
          label="Price range"
          value={event.maxPricePaise === 0 ? 'Free' : formatMoney(event.minPricePaise)}
          hint={event.maxPricePaise > event.minPricePaise ? `up to ${formatMoney(event.maxPricePaise)}` : undefined}
        />
      </div>

      {/* ── Ticket types ── */}
      <section className="rounded-xl border border-ink-200 bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 p-5">
          <div>
            <h2 className="text-base font-bold text-ink-900">Ticket types</h2>
            <p className="mt-0.5 text-xs text-ink-500">Tiers, pricing and availability</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAddingTier((open) => !open)}>
            <Plus className="h-4 w-4" />
            Add tier
          </Button>
        </div>

        {addingTier && (
          <AddTierForm
            eventId={id}
            onDone={async () => {
              setAddingTier(false);
              await load();
            }}
            onCancel={() => setAddingTier(false)}
          />
        )}

        {event.ticketTypes.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-500">
            No ticket types yet — add at least one before submitting this event.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Tier</th>
                  <th className="px-5 py-3 text-right font-semibold">Price</th>
                  <th className="px-5 py-3 text-right font-semibold">Sold</th>
                  <th className="px-5 py-3 text-right font-semibold">Available</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {event.ticketTypes.map((tier) => {
                  const sold = tier.quantityTotal - tier.available;
                  return (
                    <tr key={tier.id} className="transition hover:bg-ink-50">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-ink-900">{tier.name}</p>
                        <p className="mt-0.5 text-xs capitalize text-ink-500">
                          {tier.kind.replace(/_/g, ' ')}
                          {tier.seatsPerTicket > 1 && ` · admits ${tier.seatsPerTicket}`}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-right font-medium tabular-nums text-ink-900">
                        {tier.pricePaise === 0 ? 'Free' : formatMoney(tier.pricePaise)}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">{formatNumber(sold)}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">
                        {formatNumber(tier.available)} / {formatNumber(tier.quantityTotal)}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={tier.saleStatus === 'on_sale' ? 'active' : tier.saleStatus} />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => toggleTier(tier)}>
                            {tier.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-rose-600 hover:bg-rose-50"
                            onClick={() => deleteTier(tier.id)}
                            aria-label={`Delete ${tier.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`/organizer/bookings?eventId=${id}`}
          className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-card transition hover:shadow-lift"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
            <CalendarDays className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink-900">View bookings</span>
            <span className="text-xs text-ink-500">Attendee list and CSV export</span>
          </span>
        </Link>

        <Link
          href={`/organizer/scan?eventId=${id}`}
          className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-card transition hover:shadow-lift"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
            <QrCode className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink-900">Scan tickets</span>
            <span className="text-xs text-ink-500">Check attendees in at the door</span>
          </span>
        </Link>
      </div>

      <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
        <h2 className="text-base font-bold text-ink-900">Venue</h2>
        <p className="mt-2 flex items-start gap-2 text-sm text-ink-600">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          <span>
            <span className="font-medium text-ink-900">{event.venue.name}</span>
            <br />
            {event.venue.addressLine1}, {event.city.name}, {event.city.state}
          </span>
        </p>
      </section>
    </div>
  );
}

function AddTierForm({
  eventId,
  onDone,
  onCancel,
}: {
  eventId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    kind: 'regular',
    price: '',
    quantityTotal: '',
    maxPerOrder: '10',
    seatsPerTicket: '1',
  });

  async function submit() {
    if (!form.name.trim() || !form.quantityTotal) {
      toast.error('Name and quantity are required');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/organizer/events/${eventId}/ticket-types`, {
        name: form.name.trim(),
        kind: form.kind,
        price: Number(form.price || 0),
        quantityTotal: Number(form.quantityTotal),
        maxPerOrder: Number(form.maxPerOrder || 10),
        seatsPerTicket: Number(form.seatsPerTicket || 1),
      });
      toast.success('Ticket type added');
      onDone();
    } catch (err) {
      toast.error('Could not add', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-ink-200 bg-ink-50 p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VIP Lounge" />
        </Field>
        <Field label="Type">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {TICKET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price (₹)">
          <Input
            type="number"
            min={0}
            className="no-spinner"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        </Field>
        <Field label="Quantity">
          <Input
            type="number"
            min={1}
            className="no-spinner"
            value={form.quantityTotal}
            onChange={(e) => setForm({ ...form, quantityTotal: e.target.value })}
          />
        </Field>
        <Field label="Max per order">
          <Input
            type="number"
            min={1}
            className="no-spinner"
            value={form.maxPerOrder}
            onChange={(e) => setForm({ ...form, maxPerOrder: e.target.value })}
          />
        </Field>
        <Field label="Admits">
          <Input
            type="number"
            min={1}
            className="no-spinner"
            value={form.seatsPerTicket}
            onChange={(e) => setForm({ ...form, seatsPerTicket: e.target.value })}
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={submit} loading={saving}>
          Add ticket type
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
