'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Landmark, Trash2, UserPlus } from 'lucide-react';
import { ApiError, api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { AdminRestaurant } from '@/lib/types';
import { cn, rupees } from '@/lib/format';
import { STATUS_LABEL, STATUS_STYLE } from '@/components/admin/admin-shell';
import { Photo } from '@/components/ui/photo';
import { Skeleton } from '@/components/ui/feedback';

const TRANSITIONS: Record<string, Array<{ to: AdminRestaurant['status']; label: string; tone: string }>> = {
  pending_review: [{ to: 'live', label: 'Take live', tone: 'bg-save-600 text-white' }],
  draft: [{ to: 'pending_review', label: 'Send to review', tone: 'bg-ink-900 text-white' }],
  live: [
    { to: 'paused', label: 'Pause', tone: 'ring-1 ring-inset ring-ink-300' },
    { to: 'delisted', label: 'Delist', tone: 'text-rose-600 ring-1 ring-inset ring-rose-200' },
  ],
  paused: [
    { to: 'live', label: 'Resume', tone: 'bg-save-600 text-white' },
    { to: 'delisted', label: 'Delist', tone: 'text-rose-600 ring-1 ring-inset ring-rose-200' },
  ],
  delisted: [{ to: 'pending_review', label: 'Re-open review', tone: 'ring-1 ring-inset ring-ink-300' }],
};

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? (error.fieldMessages[0] ?? error.message) : fallback;
}

export default function AdminRestaurantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['admin-restaurant', id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: async () => (await api.get<AdminRestaurant>(`/admin/dining/restaurants/${id}`)).data });

  const [commercials, setCommercials] = useState({ commissionPercent: '', serviceChargePercent: '', gstin: '', fssai: '' });
  const [member, setMember] = useState({ email: '', role: 'manager' });
  const [payout, setPayout] = useState({ amount: '', utr: '' });

  useEffect(() => {
    if (data) {
      setCommercials({
        commissionPercent: String(data.commissionPercent),
        serviceChargePercent: String(data.serviceChargePercent),
        gstin: data.gstin ?? '',
        fssai: data.fssai ?? '',
      });
    }
  }, [data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['admin-restaurants'] });
  };

  const status = useMutation({
    mutationFn: async (to: string) => api.patch(`/admin/dining/restaurants/${id}/status`, { status: to }),
    onSuccess: (_, to) => {
      toast.success(`Now ${STATUS_LABEL[to]?.toLowerCase()}`);
      refresh();
    },
    onError: (e) => toast.error('Could not change status', errorText(e, '')),
  });
  const saveCommercials = useMutation({
    mutationFn: async () =>
      api.patch(`/admin/dining/restaurants/${id}/commercials`, {
        commissionPercent: Number(commercials.commissionPercent),
        serviceChargePercent: Number(commercials.serviceChargePercent),
        gstin: commercials.gstin || null,
        fssai: commercials.fssai || null,
      }),
    onSuccess: () => {
      toast.success('Commercials saved', 'New bills use the new commission; past bills keep theirs.');
      refresh();
    },
    onError: (e) => toast.error('Could not save', errorText(e, '')),
  });
  const addMember = useMutation({
    mutationFn: async () => api.post(`/admin/dining/restaurants/${id}/members`, member),
    onSuccess: () => {
      setMember({ email: '', role: 'manager' });
      toast.success('Staff added', 'They sign in with their existing Tixit account.');
      refresh();
    },
    onError: (e) => toast.error('Could not add', errorText(e, '')),
  });
  const removeMember = useMutation({
    mutationFn: async (userId: string) => api.delete(`/admin/dining/restaurants/${id}/members/${userId}`),
    onSuccess: refresh,
    onError: (e) => toast.error('Could not remove', errorText(e, '')),
  });
  const settle = useMutation({
    mutationFn: async () => api.post<{ reference: string }>(`/admin/dining/restaurants/${id}/settlements`, { amount: Number(payout.amount), utr: payout.utr || null }),
    onSuccess: (res) => {
      toast.success('Payout recorded', res.data.reference);
      setPayout({ amount: '', utr: '' });
      refresh();
    },
    onError: (e) => toast.error('Could not record payout', errorText(e, '')),
  });

  if (isLoading || !data) return <div className="p-8"><Skeleton className="h-96 rounded-3xl" /></div>;

  const card = 'rounded-3xl bg-white p-5 ring-1 ring-ink-200';
  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Restaurants
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Photo src={data.coverUrl} alt="" sizes="80px" className="h-20 w-20 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', STATUS_STYLE[data.status])}>{STATUS_LABEL[data.status]}</span>
          <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight">{data.name}</h1>
          <p className="text-sm text-ink-500">{data.address} · {data.city}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(TRANSITIONS[data.status] ?? []).map((t) => (
            <button key={t.to} onClick={() => status.mutate(t.to)} disabled={status.isPending} className={cn('press h-10 rounded-xl px-4 text-sm font-bold disabled:opacity-60', t.tone)}>
              {t.label}
            </button>
          ))}
          <Link href={`/r/${data.slug}`} className="press inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-600 ring-1 ring-inset ring-ink-200">
            <ExternalLink className="h-4 w-4" /> Page
          </Link>
          <Link href={`/partner/${data.id}`} className="press inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-600 ring-1 ring-inset ring-ink-200">
            Console
          </Link>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Owed to restaurant', rupees(data.payableBalancePaise)],
          ['Bills on Tixit', data.lifetime.bills.toLocaleString('en-IN')],
          ['Gross through Tixit', rupees(data.lifetime.grossPaise)],
          ['Commission earned', rupees(data.lifetime.commissionPaise)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-3xl bg-white p-4 ring-1 ring-ink-200">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{label}</dt>
            <dd className="num mt-1 text-xl font-black tracking-tight">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="font-bold">Commercials</h2>
          <p className="text-xs text-ink-500">Each bill freezes its commission when priced, so changes never touch history.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {(
              [
                ['commissionPercent', 'Commission % of net sales'],
                ['serviceChargePercent', 'Service charge %'],
                ['gstin', 'GSTIN'],
                ['fssai', 'FSSAI'],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>
                <label className="label" htmlFor={k}>{label}</label>
                <input id={k} className="input" value={commercials[k]} onChange={(e) => setCommercials((c) => ({ ...c, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <button onClick={() => saveCommercials.mutate()} disabled={saveCommercials.isPending} className="press mt-4 h-11 rounded-xl bg-ink-900 px-5 text-sm font-bold text-white disabled:opacity-60">
            Save commercials
          </button>
        </section>

        <section className={card}>
          <h2 className="flex items-center gap-2 font-bold"><Landmark className="h-4 w-4 text-ink-400" /> Record a payout</h2>
          <p className="text-xs text-ink-500">Posted to the ledger. It can never exceed what is owed ({rupees(data.payableBalancePaise)}).</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="amount">Amount ₹</label>
              <input id="amount" inputMode="decimal" className="input" value={payout.amount} onChange={(e) => setPayout((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="utr">Bank UTR</label>
              <input id="utr" className="input" value={payout.utr} onChange={(e) => setPayout((p) => ({ ...p, utr: e.target.value }))} />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setPayout((p) => ({ ...p, amount: String(data.payableBalancePaise / 100) }))}
              className="press h-11 rounded-xl px-4 text-sm font-semibold ring-1 ring-inset ring-ink-300"
            >
              Full balance
            </button>
            <button onClick={() => settle.mutate()} disabled={!payout.amount || settle.isPending} className="press h-11 rounded-xl bg-ink-900 px-5 text-sm font-bold text-white disabled:opacity-60">
              Record payout
            </button>
          </div>
        </section>

        <section className={cn(card, 'lg:col-span-2')}>
          <h2 className="font-bold">Staff</h2>
          <p className="text-xs text-ink-500">Anyone with a Tixit account. Owners see payouts; managers edit offers and hours; hosts run bookings; cashiers verify bills.</p>
          <ul className="mt-3 divide-y divide-ink-100">
            {data.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{m.fullName}</span>
                  <span className="block truncate text-xs text-ink-500">{m.email}</span>
                </span>
                <span className="rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-bold capitalize text-ink-600">{m.role}</span>
                <button onClick={() => removeMember.mutate(m.userId)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${m.fullName}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {data.members.length === 0 && <li className="py-3 text-sm text-ink-500">No staff yet — add the owner first.</li>}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addMember.mutate();
            }}
            className="mt-3 flex flex-wrap gap-2"
          >
            <input type="email" required placeholder="name@example.com" value={member.email} onChange={(e) => setMember((m) => ({ ...m, email: e.target.value }))} className="input h-11 min-w-[220px] flex-1" aria-label="Staff email" />
            <select value={member.role} onChange={(e) => setMember((m) => ({ ...m, role: e.target.value }))} className="input h-11 w-36" aria-label="Role">
              {['owner', 'manager', 'host', 'cashier'].map((role) => (
                <option key={role} value={role}>{role[0]!.toUpperCase() + role.slice(1)}</option>
              ))}
            </select>
            <button disabled={addMember.isPending} className="press inline-flex h-11 items-center gap-1.5 rounded-xl bg-ink-900 px-4 text-sm font-bold text-white disabled:opacity-60">
              <UserPlus className="h-4 w-4" /> Add
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
