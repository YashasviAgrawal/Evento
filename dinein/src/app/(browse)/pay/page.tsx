import type { Metadata } from 'next';
import Link from 'next/link';
import { ReceiptText, ShieldCheck, Sparkles } from 'lucide-react';
import { fetchPublicPaged } from '@tixit/session';
import type { RestaurantCard } from '@/lib/types';
import { Photo } from '@/components/ui/photo';
import { OfferBadge } from '@/components/restaurant/bits';
import { TodaysTables } from './todays-table';

export const metadata: Metadata = { title: 'Pay your bill', description: 'Pay your restaurant bill on Tixit and save instantly.' };

export default async function PayPickerPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const result = await fetchPublicPaged<RestaurantCard[]>('/dining/restaurants', { city: 'jaipur', payBill: 1, q, sort: 'offer', limit: 48 }, 60);
  const restaurants = result?.data ?? [];

  return (
    <div className="container-page max-w-2xl py-6 sm:py-10">
      <div className="night rounded-[28px] p-6">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 shadow-glow">
          <ReceiptText className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">Pay your bill, keep the savings</h1>
        <p className="mt-1.5 text-sm text-ink-300">Offers apply automatically. Takes about ten seconds.</p>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-300">
          <li className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-brand-300" /> Every saving itemised</li>
          <li className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-brand-300" /> Service charge always optional</li>
        </ul>
      </div>

      <TodaysTables />

      <section className="mt-6">
        <h2 className="eyebrow text-ink-400">Where are you eating?</h2>
        <form className="mt-2" role="search">
          <input name="q" defaultValue={q} placeholder="Search restaurant name" className="input h-12 rounded-2xl" aria-label="Search restaurant" />
        </form>
        <ul className="mt-3 divide-y divide-ink-100 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
          {restaurants.map((restaurant) => (
            <li key={restaurant.id}>
              <Link href={`/pay/${restaurant.slug}`} className="flex items-center gap-3.5 p-3.5 transition hover:bg-ink-50">
                <Photo src={restaurant.coverUrl} alt="" sizes="56px" className="h-14 w-14 shrink-0 rounded-2xl" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{restaurant.name}</span>
                  <span className="block truncate text-xs text-ink-500">{restaurant.locality} · {restaurant.cuisines.slice(0, 2).join(', ')}</span>
                </span>
                {restaurant.bestOffer && <OfferBadge label={restaurant.bestOffer.label} tone="soft" />}
              </Link>
            </li>
          ))}
          {restaurants.length === 0 && <li className="p-6 text-center text-sm text-ink-500">No restaurant by that name takes Tixit payments yet.</li>}
        </ul>
      </section>
    </div>
  );
}
