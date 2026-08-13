'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Plus, Tag, Ticket, Trash2 } from 'lucide-react';
import { api, ApiError, type PageMeta } from '@/lib/api';
import type { EventCard } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, Field, Input, Select, Skeleton, StatusBadge, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { cn, formatDateTime, formatMoney, formatNumber } from '@/lib/format';

interface OrganizerCoupon {
  id: string;
  code: string;
  description: string | null;
  type: 'percent' | 'flat';
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  usageLimitTotal: number | null;
  usageLimitPerUser: number;
  usedCount: number;
  validUntil: string | null;
  isActive: boolean;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  eventId: string | null;
  eventTitle: string | null;
  createdAt: string;
}

const TABS = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Awaiting approval' },
  { key: 'approved', label: 'Live' },
  { key: 'rejected', label: 'Rejected' },
];

export default function OrganizerCouponsPage() {
  const toast = useToast();

  const [coupons, setCoupons] = useState<OrganizerCoupon[]>([]);
  const [events, setEvents] = useState<EventCard[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<OrganizerCoupon[]>('/organizer/coupons', {
        query: { status: status || undefined, page, limit: 20 },
      });
      setCoupons(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<EventCard[]>('/organizer/events', { query: { limit: 50 } })
      .then((r) => setEvents(r.data))
      .catch(() => setEvents([]));
  }, []);

  async function toggle(coupon: OrganizerCoupon) {
    try {
      await api.post(`/organizer/coupons/${coupon.id}/toggle`, { isActive: !coupon.isActive });
      toast.success(coupon.isActive ? 'Coupon switched off' : 'Coupon switched on');
      await load();
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function remove(coupon: OrganizerCoupon) {
    if (!window.confirm(`Delete coupon ${coupon.code}?`)) return;
    try {
      await api.delete(`/organizer/coupons/${coupon.id}`);
      toast.success('Coupon deleted');
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : undefined);
    }
  }

  function describe(coupon: OrganizerCoupon): string {
    if (coupon.type === 'percent') {
      const cap = coupon.maxDiscountPaise ? `, up to ${formatMoney(coupon.maxDiscountPaise)}` : '';
      return `${coupon.value}% off${cap}`;
    }
    return `${formatMoney(coupon.value)} off`;
  }

  const pendingCount = coupons.filter((c) => c.approvalStatus === 'pending').length;

  return (
    <div>
      <PageHeader
        title="Coupons"
        description="Run a discount on your events. Each one is reviewed before it goes live."
        actions={
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus className="h-4 w-4" />
            New coupon
          </Button>
        }
      />

      {creating && (
        <CouponForm
          events={events}
          onDone={async () => {
            setCreating(false);
            await load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {pendingCount > 0 && (
        <Alert tone="info" className="mb-5">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            {pendingCount} coupon{pendingCount === 1 ? '' : 's'} awaiting approval. Customers can&apos;t use{' '}
            {pendingCount === 1 ? 'it' : 'them'} until our team reviews {pendingCount === 1 ? 'it' : 'them'}.
          </span>
        </Alert>
      )}

      <div className="mb-5 flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
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

      {loading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : coupons.length === 0 ? (
        <EmptyState
          icon={<Tag className="h-9 w-9" />}
          title={status ? 'Nothing here' : 'No coupons yet'}
          description="Create a discount code to promote your event — 50% off, ₹200 off, whatever suits."
          action={<Button onClick={() => setCreating(true)}>Create your first coupon</Button>}
        />
      ) : (
        <div className="space-y-3">
          {coupons.map((coupon) => (
            <div key={coupon.id} className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-bold text-ink-900">{coupon.code}</span>
                    <span className="badge bg-brand-50 text-brand-700 ring-brand-200">{describe(coupon)}</span>
                    <StatusBadge status={coupon.approvalStatus} />
                    {!coupon.isActive && <span className="badge bg-ink-100 text-ink-600 ring-ink-200">Switched off</span>}
                  </div>

                  {coupon.description && <p className="mt-1.5 text-sm text-ink-600">{coupon.description}</p>}

                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-500">
                    <Ticket className="h-3.5 w-3.5" aria-hidden />
                    {coupon.eventTitle ? `Only for: ${coupon.eventTitle}` : 'All of your events'}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                    {coupon.minOrderPaise > 0 && <span>Min order {formatMoney(coupon.minOrderPaise)}</span>}
                    <span>
                      Used {formatNumber(coupon.usedCount)}
                      {coupon.usageLimitTotal ? ` / ${formatNumber(coupon.usageLimitTotal)}` : ''}
                    </span>
                    <span>{coupon.usageLimitPerUser} per customer</span>
                    {coupon.validUntil && <span>Expires {formatDateTime(coupon.validUntil)}</span>}
                  </div>

                  {coupon.approvalStatus === 'rejected' && coupon.reviewNote && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      <span className="font-semibold">Not approved:</span> {coupon.reviewNote}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  {coupon.approvalStatus === 'approved' && (
                    <Button variant="outline" size="sm" onClick={() => toggle(coupon)}>
                      {coupon.isActive ? 'Switch off' : 'Switch on'}
                    </Button>
                  )}
                  {coupon.usedCount === 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-rose-600 hover:bg-rose-50"
                      onClick={() => remove(coupon)}
                      aria-label={`Delete ${coupon.code}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-4">
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
      )}
    </div>
  );
}

function CouponForm({
  events,
  onDone,
  onCancel,
}: {
  events: EventCard[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    description: '',
    type: 'percent' as 'percent' | 'flat',
    value: '',
    maxDiscount: '',
    minOrder: '0',
    usageLimitTotal: '',
    usageLimitPerUser: '1',
    validUntil: '',
    eventId: '',
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!/^[A-Za-z0-9_-]{3,40}$/.test(form.code)) {
      setError('Code must be 3–40 characters: letters, numbers, hyphen or underscore');
      return;
    }
    const value = Number(form.value);
    if (!value || value <= 0) {
      setError('Enter a discount greater than zero');
      return;
    }
    if (form.type === 'percent' && value > 100) {
      setError('A percentage discount cannot be more than 100');
      return;
    }

    setSaving(true);
    try {
      await api.post('/organizer/coupons', {
        code: form.code.toUpperCase(),
        description: form.description.trim() || null,
        type: form.type,
        value,
        maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null,
        minOrder: Number(form.minOrder || 0),
        usageLimitTotal: form.usageLimitTotal ? Number(form.usageLimitTotal) : null,
        usageLimitPerUser: Number(form.usageLimitPerUser || 1),
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
        eventId: form.eventId || null,
      });
      toast.success('Coupon submitted', 'It goes live once our team approves it.');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not create the coupon');
    } finally {
      setSaving(false);
    }
  }

  // Live preview of what a customer would actually pay.
  const sample = 100000; // ₹1,000 in paise
  const value = Number(form.value) || 0;
  let discount = form.type === 'percent' ? Math.round((sample * value) / 100) : Math.round(value * 100);
  if (form.type === 'percent' && form.maxDiscount) discount = Math.min(discount, Number(form.maxDiscount) * 100);
  discount = Math.max(0, Math.min(discount, sample));

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
      <h2 className="mb-1 text-base font-bold text-ink-900">New coupon</h2>
      <p className="mb-5 text-xs text-ink-500">
        Our team reviews each coupon before customers can use it. You&apos;ll see the status here.
      </p>

      {error && (
        <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Coupon code" required hint="What customers type at checkout">
          <Input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="SUMMER50"
            className="font-mono"
          />
        </Field>

        <Field label="Applies to" hint="Pick one event, or all of yours">
          <Select value={form.eventId} onChange={(e) => setForm({ ...form, eventId: e.target.value })}>
            <option value="">All of my events</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Discount type" required>
          <Select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'flat' })}
          >
            <option value="percent">Percentage off</option>
            <option value="flat">Fixed amount off</option>
          </Select>
        </Field>

        <Field label={form.type === 'percent' ? 'Percentage (%)' : 'Amount (₹)'} required>
          <Input
            type="number"
            min={1}
            max={form.type === 'percent' ? 100 : undefined}
            className="no-spinner"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            placeholder={form.type === 'percent' ? '50' : '200'}
          />
        </Field>

        {form.type === 'percent' && (
          <Field label="Maximum discount (₹)" hint="Optional cap on how much they save">
            <Input
              type="number"
              min={1}
              className="no-spinner"
              value={form.maxDiscount}
              onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
              placeholder="500"
            />
          </Field>
        )}

        <Field label="Minimum order (₹)" hint="0 means no minimum">
          <Input
            type="number"
            min={0}
            className="no-spinner"
            value={form.minOrder}
            onChange={(e) => setForm({ ...form, minOrder: e.target.value })}
          />
        </Field>

        <Field label="Total uses" hint="Blank for unlimited">
          <Input
            type="number"
            min={1}
            className="no-spinner"
            value={form.usageLimitTotal}
            onChange={(e) => setForm({ ...form, usageLimitTotal: e.target.value })}
            placeholder="100"
          />
        </Field>

        <Field label="Uses per customer">
          <Input
            type="number"
            min={1}
            className="no-spinner"
            value={form.usageLimitPerUser}
            onChange={(e) => setForm({ ...form, usageLimitPerUser: e.target.value })}
          />
        </Field>

        <Field label="Expires on" hint="Blank means never">
          <Input
            type="datetime-local"
            value={form.validUntil}
            onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
          />
        </Field>

        <Field label="Description" hint="A note for yourself" className="sm:col-span-2 lg:col-span-3">
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="Summer promotion for early buyers"
          />
        </Field>
      </div>

      {value > 0 && (
        <div className="mt-5 rounded-lg bg-ink-50 p-4 text-sm">
          <p className="font-semibold text-ink-800">On a ₹1,000 ticket</p>
          <p className="mt-1.5 text-ink-600">
            Customer saves <span className="font-bold text-emerald-700">{formatMoney(discount)}</span> and pays{' '}
            <span className="font-bold text-ink-900">{formatMoney(sample - discount)}</span> before tax and fees.
          </p>
          <p className="mt-1.5 text-xs text-ink-500">
            The discount comes out of your earnings — the platform commission is still calculated on the original
            ₹1,000.
          </p>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <Button type="submit" loading={saving}>
          Submit for approval
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
