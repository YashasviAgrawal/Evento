'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarCheck2, Compass, ReceiptText, Search, UserRound } from 'lucide-react';
import { cn } from '@/lib/format';

const TABS = [
  { href: '/', label: 'Explore', icon: Compass, match: (p: string) => p === '/' || p.startsWith('/collections') || p.startsWith('/r/') },
  { href: '/restaurants', label: 'Search', icon: Search, match: (p: string) => p.startsWith('/restaurants') },
  { href: '/pay', label: 'Pay bill', icon: ReceiptText, match: (p: string) => p.startsWith('/pay') },
  { href: '/bookings', label: 'Plans', icon: CalendarCheck2, match: (p: string) => p.startsWith('/bookings') },
  { href: '/account', label: 'Account', icon: UserRound, match: (p: string) => p.startsWith('/account') },
];

/** Phone navigation, in thumb reach. The middle tab is the product's money moment. */
export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-ink-200/80 bg-white/90 pt-1.5 backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-end justify-around">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          const isPay = tab.href === '/pay';
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'press flex w-16 flex-col items-center gap-1 pb-1 text-[10.5px] font-semibold',
                  active ? 'text-brand-600' : 'text-ink-400',
                )}
              >
                {isPay ? (
                  <span
                    className={cn(
                      '-mt-5 grid h-12 w-12 place-items-center rounded-2xl text-white shadow-glow ring-4 ring-white transition-colors',
                      active ? 'bg-brand-600' : 'bg-ink-900',
                    )}
                  >
                    <Icon className="h-[22px] w-[22px]" aria-hidden />
                  </span>
                ) : (
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.9} aria-hidden />
                )}
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
