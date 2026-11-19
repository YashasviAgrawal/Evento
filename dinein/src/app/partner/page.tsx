'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Store } from 'lucide-react';
import { usePartnerRestaurants } from '@/components/partner/use-partner';
import { Photo } from '@/components/ui/photo';
import { EmptyState, Spinner } from '@/components/ui/feedback';
import { Wordmark } from '@/components/shell/site-header';
import { EVENTS_URL } from '@/lib/urls';

export default function PartnerHome() {
  const router = useRouter();
  const { data, isLoading } = usePartnerRestaurants();

  // One outlet: skip the chooser.
  useEffect(() => {
    if (data?.length === 1) router.replace(`/partner/${data[0]!.id}`);
  }, [data, router]);

  if (isLoading || data?.length === 1) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 py-6">
      <Wordmark />
      <h1 className="mt-8 text-2xl font-extrabold tracking-tight">Partner console</h1>
      {data && data.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-ink-500">Choose an outlet</p>
          <ul className="mt-5 space-y-2.5">
            {data.map((restaurant) => (
              <li key={restaurant.id}>
                <Link href={`/partner/${restaurant.id}`} className="press flex items-center gap-4 rounded-3xl bg-white p-3 ring-1 ring-ink-200 hover:shadow-lift">
                  <Photo src={restaurant.coverUrl} alt="" sizes="64px" className="h-16 w-16 shrink-0 rounded-2xl" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{restaurant.name}</span>
                    <span className="block text-sm capitalize text-ink-500">
                      {restaurant.locality} · {restaurant.role}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          className="mt-6"
          icon={Store}
          title="No restaurant linked to this account"
          body="If you run a restaurant, our partnerships team will set you up — your existing Tixit login is all you need."
          action={
            <a href={`${EVENTS_URL}/support`} className="press inline-flex h-11 items-center rounded-2xl bg-ink-900 px-5 text-sm font-bold text-white">
              Talk to us
            </a>
          }
        />
      )}
    </div>
  );
}
