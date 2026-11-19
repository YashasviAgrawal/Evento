'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, PartyPopper, Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { AdminRestaurantRow, Festival, FestivalPage } from '@/lib/types';
import type { CityOption } from '@/lib/city';
import { cn, plural, rupees } from '@/lib/format';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { festivalDates } from '@/components/restaurant/festival-banner';

interface Promotion {
  id: string;
  restaurant: { id: string; name: string; city: string };
  startsOn: string;
  endsOn: string;
  dailyPricePaise: number;
  totalPaise: number;
  status: string;
  phase: 'scheduled' | 'live' | 'ended' | 'cancelled';
}

const card = 'rounded-3xl bg-white p-5 ring-1 ring-ink-200';
const errorText = (error: unknown) => (error instanceof ApiError ? (error.fieldMessages[0] ?? error.message) : 'Something went wrong');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const PHASE: Record<string, string> = {
  on: 'bg-save-50 text-save-700',
  live: 'bg-save-50 text-save-700',
  upcoming: 'bg-amber-50 text-amber-700',
  scheduled: 'bg-amber-50 text-amber-700',
  over: 'bg-ink-100 text-ink-500',
  ended: 'bg-ink-100 text-ink-500',
  cancelled: 'bg-ink-100 text-ink-500',
};

/**
 * Growth levers the operations team runs: city food festivals (deals that
 * apply automatically for set dates, optionally co-funded by Tixit) and
 * sponsored placements (charged to the restaurant's payouts, always labelled).
 */
export default function AdminCampaignsPage() {
  const restaurants = useQuery({
    queryKey: ['admin-restaurants'],
    queryFn: async () => (await api.get<AdminRestaurantRow[]>('/admin/dining/restaurants')).data,
  });
  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Campaigns</h1>
      <p className="text-sm text-ink-500">Food festivals and sponsored listings.</p>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Festivals restaurants={restaurants.data ?? []} />
        <Promotions restaurants={restaurants.data ?? []} />
      </div>
    </div>
  );
}

/* ───────────────────────── festivals ───────────────────────── */

function Festivals({ restaurants }: { restaurants: AdminRestaurantRow[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<Festival | null>(null);
  const [form, setForm] = useState({ title: '', citySlug: 'jaipur', tagline: '', description: '', coverUrl: '', startsOn: today(), endsOn: today() });
  const [error, setError] = useState<string | null>(null);

  const festivals = useQuery({ queryKey: ['admin-festivals'], queryFn: async () => (await api.get<Festival[]>('/admin/dining/festivals')).data });
  const cities = useQuery({ queryKey: ['dining-cities'], queryFn: async () => (await api.get<CityOption[]>('/dining/cities')).data });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-festivals'] });

  const create = useMutation({
    mutationFn: async () =>
      api.post('/admin/dining/festivals', {
        ...form,
        tagline: form.tagline || null,
        description: form.description || null,
        coverUrl: form.coverUrl || null,
      }),
    onSuccess: () => {
      toast.success('Festival created', 'Add restaurants, then publish it.');
      setCreating(false);
      refresh();
    },
    onError: (e) => setError(errorText(e)),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Festival['status'] }) => api.patch(`/admin/dining/festivals/${id}/status`, { status }),
    onSuccess: (_, { status }) => {
      toast.success(status === 'published' ? 'Festival is live' : status === 'archived' ? 'Festival archived — its deals have ended' : 'Back to draft');
      refresh();
    },
    onError: (e) => toast.error('Could not update', errorText(e)),
  });

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-bold">
          <PartyPopper className="h-4 w-4 text-brand-600" /> Food festivals
        </h2>
        <button
          onClick={() => {
            setError(null);
            setCreating(true);
          }}
          className="press inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink-900 px-3 text-xs font-bold text-white"
        >
          <Plus className="h-3.5 w-3.5" /> New festival
        </button>
      </div>
      {festivals.isLoading ? (
        <Skeleton className="mt-4 h-32" />
      ) : (festivals.data ?? []).length === 0 ? (
        <EmptyState icon={PartyPopper} title="No festivals yet" body="A dated, city-wide campaign with a deal at each restaurant." />
      ) : (
        <ul className="mt-3 divide-y divide-ink-100">
          {festivals.data!.map((festival) => (
            <li key={festival.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{festival.title}</span>
                <span className="block text-xs text-ink-500">
                  {festival.city.name} · {festivalDates(festival)} · {plural(festival.participants, 'restaurant')}
                </span>
              </span>
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', festival.status === 'published' ? PHASE[festival.phase] : 'bg-ink-100 text-ink-500')}>
                {festival.status === 'published' ? festival.phase : festival.status}
              </span>
              <button onClick={() => setManaging(festival)} className="press h-8 rounded-xl px-3 text-xs font-bold ring-1 ring-inset ring-ink-200">
                Restaurants
              </button>
              {festival.status === 'draft' && (
                <button onClick={() => setStatus.mutate({ id: festival.id, status: 'published' })} className="press h-8 rounded-xl bg-brand-600 px-3 text-xs font-bold text-white">
                  Publish
                </button>
              )}
              {festival.status === 'published' && (
                <button
                  onClick={() => window.confirm('Archive this festival? Its deals stop applying.') && setStatus.mutate({ id: festival.id, status: 'archived' })}
                  className="press h-8 rounded-xl px-3 text-xs font-bold text-ink-500"
                >
                  Archive
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={creating}
        onClose={() => setCreating(false)}
        title="New festival"
        subtitle="Created as a draft; nothing is public until you publish."
        footer={
          <button onClick={() => create.mutate()} disabled={create.isPending} className="press mb-1 h-12 w-full rounded-2xl bg-ink-900 font-bold text-white disabled:opacity-60">
            {create.isPending ? 'Creating…' : 'Create draft'}
          </button>
        }
      >
        <div className="space-y-3 pt-1">
          <div>
            <label className="label" htmlFor="f-title">Name</label>
            <input id="f-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Jaipur Winter Food Week" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="f-city">City</label>
              <select id="f-city" className="input" value={form.citySlug} onChange={(e) => setForm({ ...form, citySlug: e.target.value })}>
                {(cities.data ?? []).map((city) => (
                  <option key={city.slug} value={city.slug}>
                    {city.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="f-from">From</label>
              <input id="f-from" type="date" className="input" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="f-to">To</label>
              <input id="f-to" type="date" className="input" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="f-tag">Tagline</label>
            <input id="f-tag" className="input" value={form.tagline} maxLength={140} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="f-desc">Description</label>
            <textarea id="f-desc" rows={3} className="input resize-none" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="f-cover">Cover image URL</label>
            <input id="f-cover" className="input" value={form.coverUrl} onChange={(e) => setForm({ ...form, coverUrl: e.target.value })} placeholder="https://…" />
          </div>
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
        </div>
      </Sheet>

      {managing && <Participants festival={managing} restaurants={restaurants} onClose={() => setManaging(null)} onChange={refresh} />}
    </section>
  );
}

function Participants({
  festival,
  restaurants,
  onClose,
  onChange,
}: {
  festival: Festival;
  restaurants: AdminRestaurantRow[];
  onClose: () => void;
  onChange: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['admin-festival', festival.slug];
  const detail = useQuery({ queryKey: key, queryFn: async () => (await api.get<FestivalPage>(`/admin/dining/festivals/${festival.slug}`)).data });
  const [draft, setDraft] = useState({ restaurantId: '', percentOff: '20', restaurantFundedPct: '100', highlight: '' });
  const inFestival = new Set((detail.data?.restaurants ?? []).map((r) => r.card.id));
  const candidates = restaurants.filter((r) => r.city === festival.city.name && r.status === 'live' && !inFestival.has(r.id));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    onChange();
  };
  const add = useMutation({
    mutationFn: async () =>
      api.post(`/admin/dining/festivals/${festival.id}/restaurants`, {
        restaurantId: draft.restaurantId,
        kind: 'percent',
        percentOff: Number(draft.percentOff),
        restaurantFundedPct: Number(draft.restaurantFundedPct),
        highlight: draft.highlight || null,
      }),
    onSuccess: () => {
      setDraft({ ...draft, restaurantId: '', highlight: '' });
      refresh();
    },
    onError: (e) => toast.error('Could not add', errorText(e)),
  });
  const remove = useMutation({
    mutationFn: async (restaurantId: string) => api.delete(`/admin/dining/festivals/${festival.id}/restaurants/${restaurantId}`),
    onSuccess: refresh,
  });

  return (
    <Sheet open onClose={onClose} title={festival.title} subtitle={`${festival.city.name} · ${festivalDates(festival)}`}>
      <div className="space-y-4 pt-1">
        <ul className="divide-y divide-ink-100 rounded-2xl ring-1 ring-ink-200">
          {(detail.data?.restaurants ?? []).map(({ card: restaurant, deal, highlight }) => (
            <li key={restaurant.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{restaurant.name}</span>
                <span className="block truncate text-xs text-ink-500">
                  {deal.label} · restaurant funds {deal.restaurantFundedPct}%{highlight ? ` · ${highlight}` : ''}
                </span>
              </span>
              <button onClick={() => remove.mutate(restaurant.id)} className="press grid h-8 w-8 place-items-center rounded-xl text-ink-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${restaurant.name}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
          {detail.data && detail.data.restaurants.length === 0 && <li className="px-3 py-4 text-center text-sm text-ink-500">No restaurants yet.</li>}
        </ul>

        <div className="rounded-2xl bg-ink-50 p-3">
          <p className="text-sm font-bold">Add a restaurant</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <select className="input col-span-3" value={draft.restaurantId} onChange={(e) => setDraft({ ...draft, restaurantId: e.target.value })} aria-label="Restaurant">
              <option value="">Choose a restaurant in {festival.city.name}…</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.locality}
                </option>
              ))}
            </select>
            <div>
              <label className="label" htmlFor="p-pct">% off</label>
              <input id="p-pct" className="input" inputMode="numeric" value={draft.percentOff} onChange={(e) => setDraft({ ...draft, percentOff: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="p-fund">Restaurant funds (%) — Tixit the rest</label>
              <input id="p-fund" className="input" inputMode="numeric" value={draft.restaurantFundedPct} onChange={(e) => setDraft({ ...draft, restaurantFundedPct: e.target.value.replace(/\D/g, '') })} />
            </div>
            <input className="input col-span-3" placeholder="Highlight, e.g. Five-course tasting menu" value={draft.highlight} maxLength={120} onChange={(e) => setDraft({ ...draft, highlight: e.target.value })} aria-label="Highlight" />
          </div>
          <button onClick={() => add.mutate()} disabled={!draft.restaurantId || add.isPending} className="press mt-2 h-10 w-full rounded-xl bg-ink-900 text-sm font-bold text-white disabled:opacity-50">
            Add to festival
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ───────────────────────── sponsored listings ───────────────────────── */

function Promotions({ restaurants }: { restaurants: AdminRestaurantRow[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ restaurantId: '', startsOn: today(), endsOn: today(), dailyPrice: '499' });
  const promotions = useQuery({ queryKey: ['admin-promotions'], queryFn: async () => (await api.get<Promotion[]>('/admin/dining/promotions')).data });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-promotions'] });

  const days = Math.max(0, Math.round((Date.parse(draft.endsOn) - Date.parse(draft.startsOn)) / 86_400_000) + 1);
  const net = days * Number(draft.dailyPrice || 0) * 100;

  const create = useMutation({
    mutationFn: async () => api.post('/admin/dining/promotions', { ...draft, dailyPrice: Number(draft.dailyPrice) }),
    onSuccess: () => {
      toast.success('Campaign booked', 'Charged to the restaurant’s payouts.');
      setDraft({ ...draft, restaurantId: '' });
      refresh();
    },
    onError: (e) => toast.error('Could not book it', errorText(e)),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => api.post(`/admin/dining/promotions/${id}/cancel`),
    onSuccess: () => {
      toast.success('Campaign cancelled', 'The charge was reversed.');
      refresh();
    },
    onError: (e) => toast.error('Could not cancel', errorText(e)),
  });

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 font-bold">
        <Megaphone className="h-4 w-4 text-brand-600" /> Sponsored listings
      </h2>
      <p className="text-xs text-ink-500">Top of default search in the restaurant’s city, labelled “Sponsored”. Cancellable until it starts.</p>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-ink-50 p-3 sm:grid-cols-4">
        <select className="input col-span-2 sm:col-span-4" value={draft.restaurantId} onChange={(e) => setDraft({ ...draft, restaurantId: e.target.value })} aria-label="Restaurant">
          <option value="">Choose a restaurant…</option>
          {restaurants
            .filter((r) => r.status === 'live')
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.city}
              </option>
            ))}
        </select>
        <div>
          <label className="label" htmlFor="pr-from">From</label>
          <input id="pr-from" type="date" min={today()} className="input" value={draft.startsOn} onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="pr-to">To</label>
          <input id="pr-to" type="date" min={draft.startsOn} className="input" value={draft.endsOn} onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="pr-rate">₹ per day</label>
          <input id="pr-rate" className="input" inputMode="numeric" value={draft.dailyPrice} onChange={(e) => setDraft({ ...draft, dailyPrice: e.target.value.replace(/\D/g, '') })} />
        </div>
        <button onClick={() => create.mutate()} disabled={!draft.restaurantId || days < 1 || create.isPending} className="press h-12 self-end rounded-xl bg-ink-900 px-3 text-sm font-bold text-white disabled:opacity-50">
          Book {days > 0 ? rupees(Math.round(net * 1.18)) : ''}
        </button>
        <p className="col-span-2 text-[11px] text-ink-500 sm:col-span-4">
          {days} day{days === 1 ? '' : 's'} × ₹{draft.dailyPrice || 0} + 18% GST, charged to payouts and shown on the month’s invoice.
        </p>
      </div>

      {promotions.isLoading ? (
        <Skeleton className="mt-4 h-24" />
      ) : (
        <ul className="mt-3 divide-y divide-ink-100">
          {(promotions.data ?? []).map((promo) => (
            <li key={promo.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{promo.restaurant.name}</span>
                <span className="block text-xs text-ink-500">
                  {festivalDates(promo)} · {rupees(promo.dailyPricePaise)}/day · {rupees(promo.totalPaise)} incl. GST
                </span>
              </span>
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', PHASE[promo.phase])}>{promo.phase}</span>
              {promo.phase === 'scheduled' && (
                <button onClick={() => window.confirm('Cancel and reverse the charge?') && cancel.mutate(promo.id)} className="press h-8 rounded-xl px-3 text-xs font-bold text-ink-500">
                  Cancel
                </button>
              )}
            </li>
          ))}
          {promotions.data?.length === 0 && <li className="py-6 text-center text-sm text-ink-500">No campaigns yet.</li>}
        </ul>
      )}
    </section>
  );
}
