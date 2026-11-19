'use client';

import { use } from 'react';
import { Store } from 'lucide-react';
import { PartnerShell } from '@/components/partner/partner-shell';
import { useLive, usePartnerRestaurant } from '@/components/partner/use-partner';
import { EmptyState, Spinner } from '@/components/ui/feedback';

export default function RestaurantPartnerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { restaurant, data, isLoading } = usePartnerRestaurant(id);
  const live = useLive(id, Boolean(restaurant?.capabilities.includes('bills.verify')));

  if (isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!restaurant) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyState icon={Store} title="You don’t have access to this outlet" body="Ask the owner to add you as staff." />
      </div>
    );
  }
  return (
    <PartnerShell restaurant={restaurant} restaurants={data ?? []} badge={live.data?.summary.billsToVerify}>
      {children}
    </PartnerShell>
  );
}
