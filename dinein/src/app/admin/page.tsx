'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus, Search, Store } from 'lucide-react';
import { ApiError, api } from '@tixit/session';
import type { AdminRestaurantRow } from '@/lib/types';
import { cn } from '@/lib/format';
import { STATUS_LABEL, STATUS_STYLE } from '@/components/admin/admin-shell';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, Skeleton } from '@/components/ui/feedback';

const FILTERS = ['all', 'pending_review', 'live', 'paused', 'delisted'] as const;

interface City {
  id: string;
  name: string;
  slug: string;
}

const EMPTY = {
  name: '',
  citySlug: 'jaipur',
  locality: '',
  address: '',
  lat: '',
  lng: '',
  costForTwo: '',
  cuisines: '',
  tags: '',
  coverUrl: '',
  commissionPercent: '6',
  serviceChargePercent: '0',
  gstin: '',
  fssai: '',
  ownerEmail: '',
};

export default function AdminRestaurantsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['admin-restaurants'],
    queryFn: async () => (await api.get<AdminRestaurantRow[]>('/admin/dining/restaurants')).data,
  });
  const cities = useQuery({
    queryKey: ['cities'],
    queryFn: async () => (await api.get<City[]>('/catalog/cities')).data,
    enabled: open,
    staleTime: Infinity,
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (list.data ?? []).filter(
      (row) =>
        (filter === 'all' || row.status === filter) &&
        (!term || `${row.name} ${row.locality} ${row.city}`.toLowerCase().includes(term)),
    );
  }, [list.data, filter, q]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: list.data?.length ?? 0 };
    (list.data ?? []).forEach((row) => (map[row.status] = (map[row.status] ?? 0) + 1));
    return map;
  }, [list.data]);

  const create = useMutation({
    mutationFn: async () => {
      const split = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
      return (
        await api.post<{ id: string }>('/admin/dining/restaurants', {
          name: form.name,
          citySlug: form.citySlug,
          locality: form.locality,
          address: form.address,
          lat: Number(form.lat),
          lng: Number(form.lng),
          costForTwo: Number(form.costForTwo),
          cuisines: split(form.cuisines),
          tags: split(form.tags).map((tag) => tag.toLowerCase().replace(/\s+/g, '-')),
          coverUrl: form.coverUrl || null,
          commissionPercent: Number(form.commissionPercent),
          serviceChargePercent: Number(form.serviceChargePercent),
          gstin: form.gstin || null,
          fssai: form.fssai || null,
          ownerEmail: form.ownerEmail || null,
        })
      ).data;
    },
    onSuccess: (created) => router.push(`/admin/${created.id}`),
    onError: (err) => setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not create the restaurant'),
  });

  const field = (key: keyof typeof EMPTY, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={key}>{label}</label>
      <input id={key} className="input" value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...props} />
    </div>
  );

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Restaurants</h1>
          <p className="text-sm text-ink-500">Onboard outlets, take them live, set commercials and pay them out.</p>
        </div>
        <button
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="press inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white shadow-glow"
        >
          <Plus className="h-4 w-4" /> Onboard restaurant
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={cn(
              'press h-9 rounded-full px-3.5 text-[13px] font-semibold',
              filter === value ? 'bg-ink-900 text-white' : 'bg-white text-ink-700 ring-1 ring-inset ring-ink-200',
            )}
          >
            {value === 'all' ? 'All' : STATUS_LABEL[value]} <span className="opacity-60">{counts[value] ?? 0}</span>
          </button>
        ))}
        <label className="ml-auto flex h-9 items-center gap-2 rounded-full bg-white px-3 ring-1 ring-inset ring-ink-200">
          <Search className="h-4 w-4 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-40 bg-transparent text-sm focus:outline-none" aria-label="Search restaurants" />
        </label>
      </div>

      <div className="mt-4 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
        {list.isLoading ? (
          <Skeleton className="m-4 h-48" />
        ) : rows.length === 0 ? (
          <EmptyState className="m-4 border-0" icon={Store} title="No restaurants here" body="Try another filter, or onboard a new outlet." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-100 text-[11px] font-bold uppercase tracking-wider text-ink-400">
              <tr>
                <th className="px-4 py-3">Restaurant</th>
                <th className="hidden px-4 py-3 sm:table-cell">City</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 text-right md:table-cell">Commission</th>
                <th className="hidden px-4 py-3 text-right md:table-cell">Staff</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => (
                <tr key={row.id} className="group cursor-pointer hover:bg-ink-50" onClick={() => router.push(`/admin/${row.id}`)}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/${row.id}`} className="font-bold group-hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
                      {row.name}
                    </Link>
                    <p className="text-xs text-ink-500">{row.locality}</p>
                  </td>
                  <td className="hidden px-4 py-3 text-ink-600 sm:table-cell">{row.city}</td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', STATUS_STYLE[row.status])}>{STATUS_LABEL[row.status]}</span>
                  </td>
                  <td className="num hidden px-4 py-3 text-right md:table-cell">{row.commissionPercent}%</td>
                  <td className="num hidden px-4 py-3 text-right md:table-cell">{row.members}</td>
                  <td className="pr-3"><ChevronRight className="h-4 w-4 text-ink-300" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Onboard a restaurant"
        subtitle="It starts in review with sensible lunch and dinner hours; take it live when KYC is done."
        footer={
          <button onClick={() => create.mutate()} disabled={create.isPending} className="press mb-1 h-12 w-full rounded-2xl bg-ink-900 font-bold text-white disabled:opacity-60">
            {create.isPending ? 'Creating…' : 'Create restaurant'}
          </button>
        }
      >
        <div className="space-y-3.5 pt-1">
          {field('name', 'Restaurant name')}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="citySlug">City</label>
              <select id="citySlug" className="input" value={form.citySlug} onChange={(e) => setForm((f) => ({ ...f, citySlug: e.target.value }))}>
                {(cities.data ?? [{ id: 'j', name: 'Jaipur', slug: 'jaipur' }]).map((city) => (
                  <option key={city.slug} value={city.slug}>{city.name}</option>
                ))}
              </select>
            </div>
            {field('locality', 'Locality', { placeholder: 'C-Scheme' })}
          </div>
          {field('address', 'Full address')}
          <div className="grid grid-cols-3 gap-3">
            {field('lat', 'Latitude', { inputMode: 'decimal', placeholder: '26.9124' })}
            {field('lng', 'Longitude', { inputMode: 'decimal', placeholder: '75.7873' })}
            {field('costForTwo', 'Cost for two ₹', { inputMode: 'numeric' })}
          </div>
          {field('cuisines', 'Cuisines (comma separated)', { placeholder: 'North Indian, Mughlai' })}
          {field('tags', 'Tags (comma separated)', { placeholder: 'rooftop, date night, bar' })}
          {field('coverUrl', 'Cover photo URL', { placeholder: 'https://res.cloudinary.com/…' })}
          <div className="grid grid-cols-2 gap-3">
            {field('commissionPercent', 'Commission %', { inputMode: 'decimal' })}
            {field('serviceChargePercent', 'Service charge %', { inputMode: 'decimal' })}
            {field('gstin', 'GSTIN')}
            {field('fssai', 'FSSAI licence')}
          </div>
          {field('ownerEmail', 'Owner’s Tixit account email (optional)', { type: 'email' })}
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
        </div>
      </Sheet>
    </div>
  );
}
