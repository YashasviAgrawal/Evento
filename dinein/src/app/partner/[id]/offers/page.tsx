'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Pencil, Play, Plus, Tag, Trash2 } from 'lucide-react';
import { ApiError, api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { Offer } from '@/lib/types';
import { cn, rupees } from '@/lib/format';
import { PageHeading } from '@/components/partner/partner-shell';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, Skeleton } from '@/components/ui/feedback';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Draft {
  title: string;
  kind: 'percent' | 'flat';
  percentOff: string;
  flatOff: string;
  maxDiscount: string;
  minBill: string;
  appliesTo: 'prebook' | 'walkin' | 'both';
  days: number[];
  startTime: string;
  endTime: string;
  terms: string;
  status: 'active' | 'paused';
}

const EMPTY: Draft = {
  title: '',
  kind: 'percent',
  percentOff: '20',
  flatOff: '',
  maxDiscount: '',
  minBill: '0',
  appliesTo: 'prebook',
  days: [0, 1, 2, 3, 4, 5, 6],
  startTime: '00:00',
  endTime: '23:59',
  terms: '',
  status: 'active',
};

function toDraft(offer: Offer): Draft {
  return {
    title: offer.title,
    kind: offer.kind,
    percentOff: String(offer.percentOff ?? ''),
    flatOff: offer.flatOffPaise ? String(offer.flatOffPaise / 100) : '',
    maxDiscount: offer.maxDiscountPaise ? String(offer.maxDiscountPaise / 100) : '',
    minBill: String(offer.minBillPaise / 100),
    appliesTo: offer.appliesTo,
    days: offer.days,
    startTime: offer.startTime,
    endTime: offer.endTime === '23:59' ? '23:59' : offer.endTime,
    terms: offer.terms ?? '',
    status: offer.status === 'paused' ? 'paused' : 'active',
  };
}

function payload(draft: Draft) {
  return {
    title: draft.title,
    kind: draft.kind,
    percentOff: draft.kind === 'percent' ? Number(draft.percentOff) : null,
    flatOff: draft.kind === 'flat' ? Number(draft.flatOff) : null,
    maxDiscount: draft.maxDiscount ? Number(draft.maxDiscount) : null,
    minBill: Number(draft.minBill || 0),
    appliesTo: draft.appliesTo,
    days: draft.days,
    startTime: draft.startTime,
    endTime: draft.endTime,
    terms: draft.terms || null,
    status: draft.status,
  };
}

/**
 * Restaurants control their own offer depth — the clearest answer to "deep
 * discounts forced on us". Peak hours can carry less, quiet hours more.
 */
export default function PartnerOffersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const offers = useQuery({
    queryKey: ['partner-offers', id],
    queryFn: async () => (await api.get<Offer[]>(`/partner/r/${id}/offers`)).data,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['partner-offers', id] });

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const body = payload(editing.draft);
      if (editing.id) await api.patch(`/partner/r/${id}/offers/${editing.id}`, body);
      else await api.post(`/partner/r/${id}/offers`, body);
    },
    onSuccess: () => {
      toast.success(editing?.id ? 'Offer updated' : 'Offer is live', 'Diners see it on your page right away.');
      setEditing(null);
      refresh();
    },
    onError: (err) => setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not save'),
  });

  const toggle = useMutation({
    mutationFn: async (offer: Offer) =>
      api.patch(`/partner/r/${id}/offers/${offer.id}`, payload({ ...toDraft(offer), status: offer.status === 'active' ? 'paused' : 'active' })),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (offer: Offer) => api.delete(`/partner/r/${id}/offers/${offer.id}`),
    onSuccess: () => {
      toast.success('Offer removed');
      refresh();
    },
  });

  const set = (patch: Partial<Draft>) => setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
  const draft = editing?.draft;

  return (
    <>
      <PageHeading
        title="Offers"
        subtitle="You set the depth. Diners see validity in plain words."
        action={
          <button
            onClick={() => {
              setError(null);
              setEditing({ id: null, draft: EMPTY });
            }}
            className="press inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white shadow-glow"
          >
            <Plus className="h-4 w-4" /> New offer
          </button>
        }
      />
      <div className="px-4 pb-10 pt-5 sm:px-8">
        {offers.isLoading ? (
          <Skeleton className="h-40 rounded-3xl" />
        ) : (offers.data ?? []).length === 0 ? (
          <EmptyState icon={Tag} title="No offers yet" body="An off-peak pre-book offer is the easiest way to fill quiet tables." />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {offers.data!.map((offer) => (
              <li key={offer.id} className={cn('rounded-3xl bg-white p-4 ring-1 ring-ink-200', offer.status === 'paused' && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-2xl font-black tracking-tight text-save-700">
                      {offer.kind === 'percent' ? `${offer.percentOff}% off` : `${rupees(offer.flatOffPaise ?? 0)} off`}
                    </p>
                    <p className="font-semibold">{offer.title}</p>
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-bold',
                      offer.status === 'active' ? 'bg-save-50 text-save-700' : 'bg-ink-100 text-ink-500',
                    )}
                  >
                    {offer.status === 'active' ? 'Live' : 'Paused'}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  {offer.appliesTo === 'prebook' ? 'Pre-booked tables' : offer.appliesTo === 'walkin' ? 'Walk-ins' : 'Everyone'} · {offer.schedule}
                  {offer.minBillPaise > 0 && ` · over ${rupees(offer.minBillPaise)}`}
                </p>
                <div className="mt-3 flex gap-1.5">
                  <button onClick={() => { setError(null); setEditing({ id: offer.id, draft: toDraft(offer) }); }} className="press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold ring-1 ring-inset ring-ink-200">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button onClick={() => toggle.mutate(offer)} className="press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold ring-1 ring-inset ring-ink-200">
                    {offer.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {offer.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => remove.mutate(offer)} className="press ml-auto grid h-9 w-9 place-items-center rounded-xl text-ink-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove offer">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit offer' : 'New offer'}
        subtitle="Bills already paid keep the offer they used."
        footer={
          <button onClick={() => save.mutate()} disabled={save.isPending} className="press mb-1 h-12 w-full rounded-2xl bg-ink-900 font-bold text-white disabled:opacity-60">
            {save.isPending ? 'Saving…' : editing?.id ? 'Save changes' : 'Publish offer'}
          </button>
        }
      >
        {draft && (
          <div className="space-y-4 pt-1">
            <div>
              <label className="label" htmlFor="offer-title">Name diners will see</label>
              <input id="offer-title" className="input" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Weekday dinner: 25% off" />
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-ink-100 p-1 text-sm font-bold">
              {(['percent', 'flat'] as const).map((kind) => (
                <button key={kind} onClick={() => set({ kind })} className={cn('rounded-xl py-2', draft.kind === kind ? 'bg-white shadow-card' : 'text-ink-500')}>
                  {kind === 'percent' ? '% off' : '₹ off'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {draft.kind === 'percent' ? (
                <div>
                  <label className="label" htmlFor="pct">Percent off</label>
                  <input id="pct" className="input" inputMode="numeric" value={draft.percentOff} onChange={(e) => set({ percentOff: e.target.value.replace(/\D/g, '') })} />
                </div>
              ) : (
                <div>
                  <label className="label" htmlFor="flat">Rupees off</label>
                  <input id="flat" className="input" inputMode="numeric" value={draft.flatOff} onChange={(e) => set({ flatOff: e.target.value.replace(/\D/g, '') })} />
                </div>
              )}
              <div>
                <label className="label" htmlFor="cap">Max discount (₹)</label>
                <input id="cap" className="input" inputMode="numeric" placeholder="No cap" value={draft.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value.replace(/\D/g, '') })} />
              </div>
            </div>
            <div>
              <p className="label">Who gets it</p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['prebook', 'Pre-book'],
                    ['walkin', 'Walk-in'],
                    ['both', 'Both'],
                  ] as const
                ).map(([value, label]) => (
                  <button key={value} onClick={() => set({ appliesTo: value })} className={cn('h-10 rounded-xl text-sm font-bold ring-1 ring-inset', draft.appliesTo === value ? 'bg-ink-900 text-white ring-ink-900' : 'ring-ink-200')}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label">Days</p>
              <div className="flex gap-1.5">
                {DAYS.map((day, index) => {
                  const on = draft.days.includes(index);
                  return (
                    <button
                      key={index}
                      onClick={() => set({ days: on ? draft.days.filter((d) => d !== index) : [...draft.days, index].sort() })}
                      className={cn('h-10 flex-1 rounded-xl text-sm font-bold ring-1 ring-inset', on ? 'bg-brand-600 text-white ring-brand-600' : 'ring-ink-200 text-ink-500')}
                      aria-pressed={on}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="from">From</label>
                <input id="from" type="time" className="input" value={draft.startTime} onChange={(e) => set({ startTime: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="to">Until</label>
                <input id="to" type="time" className="input" value={draft.endTime} onChange={(e) => set({ endTime: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="min">Min bill ₹</label>
                <input id="min" className="input" inputMode="numeric" value={draft.minBill} onChange={(e) => set({ minBill: e.target.value.replace(/\D/g, '') })} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="terms">Terms (optional)</label>
              <input id="terms" className="input" value={draft.terms} onChange={(e) => set({ terms: e.target.value })} placeholder="e.g. Not valid on alcohol" />
            </div>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
          </div>
        )}
      </Sheet>
    </>
  );
}
