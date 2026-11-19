'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeftRight, CalendarDays, ExternalLink, LogOut, Tag, Wallet, Zap } from 'lucide-react';
import { useAuth } from '@tixit/session';
import type { Capability, PartnerRestaurant } from '@/lib/types';
import { cn } from '@/lib/format';

const NAV: Array<{ href: string; label: string; icon: typeof Zap; needs: Capability }> = [
  { href: '', label: 'Live', icon: Zap, needs: 'bills.verify' },
  { href: '/reservations', label: 'Reservations', icon: CalendarDays, needs: 'reservations.manage' },
  { href: '/offers', label: 'Offers', icon: Tag, needs: 'offers.manage' },
  { href: '/payouts', label: 'Payouts', icon: Wallet, needs: 'payouts.view' },
];

/**
 * The console for restaurant staff. Tixit's night surface as a sidebar on
 * wider screens, a bottom bar on a cashier's phone. Only the sections the
 * person's role allows are shown — the API enforces the same rules.
 */
export function PartnerShell({
  restaurant,
  restaurants,
  children,
  badge,
}: {
  restaurant: PartnerRestaurant;
  restaurants: PartnerRestaurant[];
  children: React.ReactNode;
  badge?: number;
}) {
  const pathname = usePathname();
  const { signOut } = useAuth();
  const base = `/partner/${restaurant.id}`;
  const items = NAV.filter((item) => restaurant.capabilities.includes(item.needs));

  return (
    <div className="min-h-dvh bg-ink-50 md:grid md:grid-cols-[232px_1fr]">
      <aside className="night sticky top-0 hidden h-dvh flex-col p-4 md:flex">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/brand/wordmark-red.png" alt="Tixit" width={474} height={175} className="h-6 w-auto brightness-0 invert" />
          <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-brand-300">Partner</span>
        </Link>
        <div className="glass mt-6 rounded-2xl p-3">
          <p className="truncate text-sm font-bold">{restaurant.name}</p>
          <p className="truncate text-xs capitalize text-ink-400">
            {restaurant.locality} · {restaurant.role}
          </p>
          {restaurants.length > 1 && (
            <Link href="/partner" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-300 hover:text-brand-200">
              <ArrowLeftRight className="h-3 w-3" /> Switch outlet
            </Link>
          )}
        </div>
        <nav className="mt-5 space-y-1" aria-label="Partner">
          {items.map(({ href, label, icon: Icon }) => {
            const target = `${base}${href}`;
            const active = href === '' ? pathname === base : pathname.startsWith(target);
            return (
              <Link
                key={label}
                href={target}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  active ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="h-4 w-4" /> {label}
                {href === '' && badge ? (
                  <span className="ml-auto rounded-full bg-brand-600 px-2 text-[11px] font-bold text-white">{badge}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-1 text-sm">
          <Link href={`/r/${restaurant.slug}`} className="flex items-center gap-3 rounded-xl px-3 py-2 text-ink-400 hover:text-white">
            <ExternalLink className="h-4 w-4" /> View public page
          </Link>
          <button onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-ink-400 hover:text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 pb-24 md:pb-0">
        <header className="night flex items-center justify-between px-4 py-3 md:hidden">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-brand-300">Tixit Partner</p>
            <p className="truncate font-bold">{restaurant.name}</p>
          </div>
          {restaurants.length > 1 && (
            <Link href="/partner" className="glass rounded-full px-3 py-1.5 text-xs font-bold">
              Switch
            </Link>
          )}
        </header>
        {children}
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-ink-200 bg-white/95 pt-1.5 backdrop-blur-xl md:hidden" aria-label="Partner">
        {items.map(({ href, label, icon: Icon }) => {
          const target = `${base}${href}`;
          const active = href === '' ? pathname === base : pathname.startsWith(target);
          return (
            <Link key={label} href={target} className={cn('relative flex w-20 flex-col items-center gap-1 pb-1 text-[11px] font-semibold', active ? 'text-brand-600' : 'text-ink-400')}>
              <Icon className="h-5 w-5" />
              {label}
              {href === '' && badge ? <span className="absolute right-4 top-0 h-2 w-2 rounded-full bg-brand-600" /> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-5 sm:px-8 sm:pt-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
