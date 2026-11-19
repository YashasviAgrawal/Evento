'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef } from 'react';
import { ReceiptText } from 'lucide-react';
import { BookingPanel } from '@/components/booking/booking-panel';
import { Sheet } from '@/components/ui/sheet';

interface Props {
  restaurant: {
    slug: string;
    name: string;
    lat: number;
    lng: number;
    bookingEnabled: boolean;
    payBillEnabled: boolean;
    coverChargePerGuestPaise?: number;
  };
  bestOfferLabel: string | null;
}

/**
 * Phones: a dock with the two money actions, always in thumb reach, and the
 * booking panel in a sheet. The sheet is URL-backed (`?book=1`), so Back closes
 * it and a "7:30 · 30% off" chip elsewhere can open it pre-selected.
 */
export function MobileBookingDock({ restaurant, bestOfferLabel }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openedHere = useRef(false);
  const open = params.get('book') === '1';

  const openSheet = () => {
    openedHere.current = true;
    router.push(`${pathname}?book=1`, { scroll: false });
  };
  const close = useCallback(() => {
    if (openedHere.current) router.back();
    else router.replace(pathname, { scroll: false });
    openedHere.current = false;
  }, [router, pathname]);

  return (
    <>
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-ink-200/80 bg-white/95 px-4 pt-3 shadow-dock backdrop-blur-xl md:hidden">
        <div className="flex gap-2.5">
          {restaurant.payBillEnabled && (
            <Link
              href={`/pay/${restaurant.slug}`}
              className="press flex flex-1 items-center justify-center gap-2 rounded-2xl bg-ink-900 py-3.5 text-[15px] font-bold text-white"
            >
              <ReceiptText className="h-4.5 w-4.5" /> Pay bill
            </Link>
          )}
          {restaurant.bookingEnabled && (
            <button
              onClick={openSheet}
              className="press flex flex-[1.4] flex-col items-center justify-center rounded-2xl bg-brand-600 py-2 text-white shadow-glow"
            >
              <span className="text-[15px] font-bold leading-tight">Book a table</span>
              {bestOfferLabel && <span className="text-[11px] font-semibold text-brand-100">up to {bestOfferLabel}</span>}
            </button>
          )}
        </div>
      </div>

      <Sheet open={open} onClose={close} title="Book a table" subtitle={restaurant.name}>
        <BookingPanel restaurant={restaurant} initialSlotId={params.get('slot')} />
      </Sheet>
    </>
  );
}

export function DesktopBookingCard({ restaurant }: Props) {
  const params = useSearchParams();
  return (
    <div className="rounded-3xl bg-white p-5 shadow-lift ring-1 ring-ink-200">
      <h2 className="text-lg font-extrabold tracking-tight">Book a table</h2>
      <p className="mb-4 text-sm text-ink-500">Free · offers lock in when you book</p>
      <BookingPanel restaurant={restaurant} initialSlotId={params.get('slot')} />
    </div>
  );
}
