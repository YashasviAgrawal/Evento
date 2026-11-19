import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { fetchPublic } from '@tixit/session';
import type { RestaurantDetail } from '@/lib/types';
import { rupees } from '@/lib/format';
import { PayBill } from '@/components/pay/pay-bill';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const restaurant = await fetchPublic<RestaurantDetail>(`/dining/restaurants/${(await params).slug}`, undefined, 60);
  return { title: restaurant ? `Pay your bill at ${restaurant.name}` : 'Pay your bill', robots: { index: false } };
}

export default async function PayPage({ params }: Props) {
  const restaurant = await fetchPublic<RestaurantDetail>(`/dining/restaurants/${(await params).slug}`, undefined, 60);
  if (!restaurant || !restaurant.payBillEnabled) notFound();

  const walkin = restaurant.offers.find((offer) => offer.appliesTo !== 'prebook');
  const walkinOffer = walkin
    ? `${walkin.kind === 'percent' ? `${walkin.percentOff}% off` : `${rupees(walkin.flatOffPaise ?? 0)} off`} on your bill`
    : null;

  return (
    <main className="min-h-dvh bg-ink-50 sm:py-6">
      <Suspense>
        <PayBill
          restaurant={{
            id: restaurant.id,
            slug: restaurant.slug,
            name: restaurant.name,
            locality: restaurant.locality,
            logoUrl: restaurant.logoUrl,
            coverUrl: restaurant.coverUrl,
            serviceChargePercent: restaurant.serviceChargePercent,
            walkinOffer,
          }}
        />
      </Suspense>
    </main>
  );
}
