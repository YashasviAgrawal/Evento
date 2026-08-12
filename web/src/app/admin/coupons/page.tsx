'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Plus, Search, Tag, Trash2, X } from 'lucide-react';
import { api, ApiError, type PageMeta } from '@/lib/api';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, Field, Input, Select, Skeleton, StatusBadge, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { cn, formatDateTime, formatMoney, formatNumber } from '@/lib/format';

interface Coupon {
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
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  /** True when an organizer authored it, so it needs review. */
  fromOrganizer: boolean;
  reviewNote: string | null;
  eventTitle: string | null;
  organizerName: string | null;
  createdAt: string;
}

const APPROVAL_TABS = [
  { key: 'pending', label: 'Awaiting review' },
  { key: '', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

export default function AdminCouponsPage() {
  const toast = useToast();

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [approval, setApproval] = useState('pending');
  const [reviewing, setReviewing] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const response = await api.get<Coupon[]>('/admin/coupons', {
        query: { q: debounced || undefined, approval: approval || undefined, page, limit: 20 },
      });
      setCoupons(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, approval, page]);

  async function review(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && note.trim().length < 3) {
      toast.error('Add a reason', 'The organizer sees this note.');
      return;
    }
    setBusyId(id);
    try {
      await api.post(`/admin/coupons/${id}/${action}`, { note: note.trim() || undefined });
      toast.success(action === 'approve' ? 'Coupon approved — now live' : 'Coupon rejected');
      setReviewing(null);
      setNote('');
      await load();
    } catch (err) {
      toast.error('Could not complete that', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(coupon: Coupon) {
    try {
      await api.patch(`/admin/coupons/${coupon.id}`, { isActive: !coupon.isActive });
      toast.success(coupon.isActive ? 'Coupon deactivated' : 'Coupon activated');
      await load();
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function remove(coupon: Coupon) {
    if (!window.confirm(`Delete coupon ${coupon.code}?`)) return;
    try {
      await api.delete(`/admin/coupons/${coupon.id}`);
      toast.success('Coupon deleted');
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : undefined);
    }
  }

  function describeDiscount(coupon: Coupon): string {
    if (coupon.type === 'percent') {
      const cap = coupon.maxDiscountPaise ? ` (max ${formatMoney(coupon.maxDiscountPaise)})` : '';
      return `${coupon.value}% off${cap}`;
    }
    return `${formatMoney(coupon.value)} off`;
  }

  return (
    <div>
      <PageHeader
        title="Coupons"
        description="Discount codes customers can apply at checkout"
        actions={
          <Button onClick={() => setCreating((open) => !open)}>
            <Plus className="h-4 w-4" />
            New coupon
          </Button>
        }
      />

      {creating && (
        <CouponForm
          onDone={async () => {
            setCreating(false);
            await load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
          {APPROVAL_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setApproval(tab.key);
                setPage(1);
              }}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition',
                approval === tab.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search coupon codes"
            className="pl-9"
            aria-label="Search coupons"
          />
        </div>
      </div>

      {reviewing?.action === 'reject' && (
        <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <Field label="Why is this coupon being rejected?" hint="The organizer sees this note on their dashboard">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              autoFocus
              placeholder="The discount is steeper than we allow for this event tier."
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={busyId === reviewing.id}
              disabled={note.trim().length < 3}
              onClick={() => review(reviewing.id, 'reject')}
            >
              Reject coupon
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setReviewing(null); setNote(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : coupons.length === 0 ? (
        <EmptyState
          icon={<Tag className="h-9 w-9" />}
          title="No coupons yet"
          description="Create a discount code to run a promotion."
          action={<Button onClick={() => setCreating(true)}>Create a coupon</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Code</th>
                  <th className="px-5 py-3 font-semibold">Discount</th>
                  <th className="px-5 py-3 font-semibold">Conditions</th>
                  <th className="px-5 py-3 text-right font-semibold">Used</th>
                  <th className="px-5 py-3 font-semibold">Valid until</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {coupons.map((coupon) => {
                  const expired = coupon.validUntil ? new Date(coupon.validUntil) < new Date() : false;
                  return (
                    <tr key={coupon.id} className="transition hover:bg-ink-50">
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-sm font-bold text-ink-900">{coupon.code}</p>
                          {coupon.fromOrganizer && <StatusBadge status={coupon.approvalStatus} />}
                        </div>
                        {coupon.description && <p className="mt-0.5 text-xs text-ink-500">{coupon.description}</p>}
                        {coupon.fromOrganizer && (
                          <p className="mt-0.5 text-xs text-ink-400">
                            Created by {coupon.organizerName ?? 'an organizer'}
                          </p>
                        )}
                        {coupon.approvalStatus === 'rejected' && coupon.reviewNote && (
                          <p className="mt-1 text-xs text-rose-600">Rejected: {coupon.reviewNote}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-medium text-ink-800">{describeDiscount(coupon)}</td>
                      <td className="px-5 py-3.5 text-xs text-ink-500">
                        {coupon.minOrderPaise > 0 && <p>Min order {formatMoney(coupon.minOrderPaise)}</p>}
                        <p>
                          {coupon.usageLimitPerUser} per user
                          {coupon.usageLimitTotal ? ` · ${formatNumber(coupon.usageLimitTotal)} total` : ' · unlimited'}
                        </p>
                        {coupon.eventTitle && <p className="truncate">Event: {coupon.eventTitle}</p>}
                        {coupon.organizerName && <p className="truncate">Organizer: {coupon.organizerName}</p>}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">
                        {formatNumber(coupon.usedCount)}
                        {coupon.usageLimitTotal && (
                          <span className="text-ink-400"> / {formatNumber(coupon.usageLimitTotal)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-ink-500">
                        {coupon.validUntil ? formatDateTime(coupon.validUntil) : 'No expiry'}
                        {expired && <span className="ml-1 font-semibold text-rose-600">· expired</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-end gap-1">
                          {coupon.approvalStatus === 'pending' ? (
                            <>
                              <Button
                                variant="success"
                                size="sm"
                                loading={busyId === coupon.id}
                                onClick={() => review(coupon.id, 'approve')}
                              >
                                <Check className="h-3.5 w-3.5" />
                                Approve
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-rose-300 text-rose-700 hover:bg-rose-50"
                                onClick={() => {
                                  setReviewing({ id: coupon.id, action: 'reject' });
                                  setNote('');
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                                Reject
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => toggle(coupon)}>
                                {coupon.isActive ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-rose-600 hover:bg-rose-50"
                                onClick={() => remove(coupon)}
                                aria-label={`Delete ${coupon.code}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-ink-200 px-5 py-3">
              <p className="text-xs text-ink-500">
                {formatNumber(meta.total)} coupons · page {meta.page} of {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CouponForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
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
      setError('Enter a discount value greater than zero');
      return;
    }
    if (form.type === 'percent' && value > 100) {
      setError('A percentage discount cannot exceed 100');
      return;
    }

    setSaving(true);
    try {
      await api.post('/admin/coupons', {
        code: form.code.toUpperCase(),
        description: form.description.trim() || null,
        type: form.type,
        value,
        maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null,
        minOrder: Number(form.minOrder || 0),
        usageLimitTotal: form.usageLimitTotal ? Number(form.usageLimitTotal) : null,
        usageLimitPerUser: Number(form.usageLimitPerUser || 1),
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
        isActive: true,
      });
      toast.success('Coupon created');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not create the coupon');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
      <h2 className="mb-5 text-base font-bold text-ink-900">New coupon</h2>

      {error && (
        <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Code" required hint="Shown to customers at checkout">
          <Input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="SUMMER25"
            className="font-mono"
          />
        </Field>

        <Field label="Discount type" required>
          <Select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'flat' })}
          >
            <option value="percent">Percentage off</option>
            <option value="flat">Flat amount off</option>
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
            placeholder={form.type === 'percent' ? '25' : '200'}
          />
        </Field>

        {form.type === 'percent' && (
          <Field label="Maximum discount (₹)" hint="Optional cap">
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

        <Field label="Minimum order (₹)">
          <Input
            type="number"
            min={0}
            className="no-spinner"
            value={form.minOrder}
            onChange={(e) => setForm({ ...form, minOrder: e.target.value })}
          />
        </Field>

        <Field label="Total redemptions" hint="Blank for unlimited">
          <Input
            type="number"
            min={1}
            className="no-spinner"
            value={form.usageLimitTotal}
            onChange={(e) => setForm({ ...form, usageLimitTotal: e.target.value })}
            placeholder="1000"
          />
        </Field>

        <Field label="Per customer">
          <Input
            type="number"
            min={1}
            className="no-spinner"
            value={form.usageLimitPerUser}
            onChange={(e) => setForm({ ...form, usageLimitPerUser: e.target.value })}
          />
        </Field>

        <Field label="Valid until" hint="Blank for no expiry">
          <Input
            type="datetime-local"
            value={form.validUntil}
            onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
          />
        </Field>

        <Field label="Description" hint="Internal note" className="sm:col-span-2 lg:col-span-3">
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="Summer campaign — 25% off, capped at ₹500"
          />
        </Field>
      </div>

      <div className="mt-5 flex gap-2">
        <Button type="submit" loading={saving}>
          Create coupon
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
