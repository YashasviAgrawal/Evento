'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Pause, Play, Plus, Tag, Trash2 } from 'lucide-react';
import { ApiError, api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { AdminOffer } from '@/lib/types';
import { cn, rupees } from '@/lib/format';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, Skeleton } from '@/components/ui/feedback';

const METHODS = [
  ['credit_card', 'Credit card'],
  ['debit_card', 'Debit card'],
  ['upi', 'UPI'],
  ['netbanking', 'Netbanking'],
] as const;

const EMPTY = {
  owner: 'platform' as 'platform' | 'bank',
  code: '',
  bankName: '',
  paymentMethods: [] as string[],
  title: '',
  kind: 'flat' as 'flat' | 'percent',
  value: '',
  maxDiscount: '',
  minBill: '',
  perUserLimit: '',
};

/**
 * Codes Tixit funds (TIXITDINE) and instant discounts a bank funds on its
 * cards. Restaurants set their own offers in the partner console.
 */
export default function AdminOffersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const offers = useQuery({ queryKey: ['admin-offers'], queryFn: async () => (await api.get<AdminOffer[]>('/admin/dining/offers')).data });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-offers'] });

  const create = useMutation({
    mutationFn: async () =>
      api.post('/admin/dining/offers', {
        owner: form.owner,
        code: form.owner === 'platform' ? form.code : null,
        bankName: form.owner === 'bank' ? form.bankName : null,
        paymentMethods: form.owner === 'bank' ? form.paymentMethods : [],
        title: form.title,
        kind: form.kind,
        percentOff: form.kind === 'percent' ? Number(form.value) : null,
        flatOff: form.kind === 'flat' ? Number(form.value) : null,
        maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null,
        minBill: Number(form.minBill || 0),
        perUserLimit: form.perUserLimit ? Number(form.perUserLimit) : null,
      }),
    onSuccess: () => {
      setOpen(false);
      setForm(EMPTY);
      toast.success('Offer is live');
      refresh();
    },
    onError: (err) => setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not create the offer'),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => api.patch(`/admin/dining/offers/${id}`, { status }),
    onSuccess: refresh,
  });

  const set = (patch: Partial<typeof EMPTY>) => setForm((current) => ({ ...current, ...patch }));
  const groups = [
    { owner: 'platform', title: 'Tixit codes', icon: Tag, hint: 'Funded by Tixit; diners type the code at checkout.' },
    { owner: 'bank', title: 'Bank offers', icon: CreditCard, hint: 'Funded by the bank; diners pick one and pay with that bank.' },
  ] as const;

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Codes &amp; bank offers</h1>
          <p className="text-sm text-ink-500">Platform-wide savings. Restaurants manage their own offers in the partner console.</p>
        </div>
        <button
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="press inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white shadow-glow"
        >
          <Plus className="h-4 w-4" /> New offer
        </button>
      </div>

      {offers.isLoading ? (
        <Skeleton className="mt-6 h-64 rounded-3xl" />
      ) : (
        groups.map(({ owner, title, icon: Icon, hint }) => {
          const rows = (offers.data ?? []).filter((offer) => offer.owner === owner);
          return (
            <section key={owner} className="mt-6">
              <h2 className="flex items-center gap-2 font-bold">
                <Icon className="h-4 w-4 text-ink-400" /> {title}
              </h2>
              <p className="text-xs text-ink-500">{hint}</p>
              {rows.length === 0 ? (
                <EmptyState className="mt-3" icon={Icon} title={`No ${title.toLowerCase()} yet`} />
              ) : (
                <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                  {rows.map((offer) => (
                    <li key={offer.id} className={cn('rounded-3xl bg-white p-4 ring-1 ring-ink-200', offer.status === 'paused' && 'opacity-60')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xl font-black tracking-tight text-save-700">
                            {offer.kind === 'percent' ? `${offer.percentOff}% off` : `${rupees(offer.flatOffPaise ?? 0)} off`}
                          </p>
                          <p className="truncate font-semibold">{offer.title}</p>
                          <p className="text-xs text-ink-500">
                            {offer.code ? <b className="text-brand-600">{offer.code}</b> : offer.bankName}
                            {offer.minBillPaise > 0 && ` · over ${rupees(offer.minBillPaise)}`}
                            {offer.maxDiscountPaise ? ` · up to ${rupees(offer.maxDiscountPaise)}` : ''}
                            {offer.perUserLimit ? ` · ${offer.perUserLimit}× per diner` : ''}
                          </p>
                        </div>
                        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', offer.status === 'active' ? 'bg-save-50 text-save-700' : 'bg-ink-100 text-ink-500')}>
                          {offer.status === 'active' ? 'Live' : 'Paused'}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-xs text-ink-500">
                        <span className="num">{offer.redemptions} uses · {rupees(offer.discountGivenPaise)} given</span>
                        <button
                          onClick={() => setStatus.mutate({ id: offer.id, status: offer.status === 'active' ? 'paused' : 'active' })}
                          className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2.5 font-bold ring-1 ring-inset ring-ink-200"
                        >
                          {offer.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          {offer.status === 'active' ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => setStatus.mutate({ id: offer.id, status: 'archived' })}
                          className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Remove offer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New offer"
        footer={
          <button onClick={() => create.mutate()} disabled={create.isPending} className="press mb-1 h-12 w-full rounded-2xl bg-ink-900 font-bold text-white disabled:opacity-60">
            {create.isPending ? 'Publishing…' : 'Publish offer'}
          </button>
        }
      >
        <div className="space-y-3.5 pt-1">
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-ink-100 p-1 text-sm font-bold">
            {(['platform', 'bank'] as const).map((owner) => (
              <button key={owner} onClick={() => set({ owner })} className={cn('rounded-xl py-2', form.owner === owner ? 'bg-white shadow-card' : 'text-ink-500')}>
                {owner === 'platform' ? 'Tixit code' : 'Bank offer'}
              </button>
            ))}
          </div>
          {form.owner === 'platform' ? (
            <div>
              <label className="label" htmlFor="code">Code</label>
              <input id="code" className="input uppercase tracking-wider" value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="WEEKEND150" />
            </div>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="bank">Bank</label>
                <input id="bank" className="input" value={form.bankName} onChange={(e) => set({ bankName: e.target.value })} placeholder="HDFC Bank" />
              </div>
              <div>
                <p className="label">Eligible instruments</p>
                <div className="flex flex-wrap gap-2">
                  {METHODS.map(([value, label]) => {
                    const on = form.paymentMethods.includes(value);
                    return (
                      <button
                        key={value}
                        onClick={() => set({ paymentMethods: on ? form.paymentMethods.filter((m) => m !== value) : [...form.paymentMethods, value] })}
                        className={cn('h-9 rounded-full px-3.5 text-[13px] font-semibold', on ? 'bg-ink-900 text-white' : 'ring-1 ring-inset ring-ink-200')}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
          <div>
            <label className="label" htmlFor="title">Name diners see</label>
            <input id="title" className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="₹150 off your bill" />
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-ink-100 p-1 text-sm font-bold">
            {(['flat', 'percent'] as const).map((kind) => (
              <button key={kind} onClick={() => set({ kind })} className={cn('rounded-xl py-2', form.kind === kind ? 'bg-white shadow-card' : 'text-ink-500')}>
                {kind === 'flat' ? '₹ off' : '% off'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['value', form.kind === 'flat' ? 'Rupees off' : 'Percent off'],
                ['maxDiscount', 'Max discount ₹'],
                ['minBill', 'Min bill ₹'],
                ['perUserLimit', 'Uses per diner'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="label" htmlFor={key}>{label}</label>
                <input id={key} className="input" inputMode="numeric" value={form[key]} onChange={(e) => set({ [key]: e.target.value.replace(/\D/g, '') })} />
              </div>
            ))}
          </div>
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
        </div>
      </Sheet>
    </div>
  );
}
