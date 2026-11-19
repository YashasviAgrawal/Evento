'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/lib/format';
import { AppSwitcher } from './app-switcher';
import { AccountMenu } from './account-menu';

const NAV = [
  { href: '/restaurants', label: 'Restaurants' },
  { href: '/pay', label: 'Pay bill' },
  { href: '/bookings', label: 'Your plans' },
];

export function Wordmark({ tone = 'light' }: { tone?: 'light' | 'night' }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Tixit Dine-in home">
      <Image
        src="/brand/wordmark-red.png"
        alt="Tixit"
        width={474}
        height={175}
        // One transparent brand asset; on the night surface it is recoloured white.
        className={cn('h-7 w-auto', tone === 'night' && 'brightness-0 invert')}
        priority
      />
      <span
        className={cn(
          'rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em]',
          tone === 'night' ? 'bg-white/10 text-brand-300' : 'bg-brand-50 text-brand-700',
        )}
      >
        Dine-in
      </span>
    </Link>
  );
}

/**
 * `night` sits transparent over the dark hero on the home page; `light` is the
 * sticky, frosted header everywhere else.
 */
export function SiteHeader({ tone = 'light' }: { tone?: 'light' | 'night' }) {
  const pathname = usePathname();
  return (
    <header
      className={cn(
        'z-40',
        tone === 'night' ? 'relative text-white' : 'sticky top-0 border-b border-ink-200/80 bg-white/85 backdrop-blur-xl',
      )}
    >
      <div className="container-page flex h-16 items-center gap-4">
        <Wordmark tone={tone} />
        <AppSwitcher tone={tone} className="hidden md:inline-flex" />

        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Dine-in">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-full px-3.5 py-2 text-sm font-semibold transition-colors',
                  tone === 'night'
                    ? active
                      ? 'bg-white/10 text-white'
                      : 'text-ink-300 hover:text-white'
                    : active
                      ? 'bg-ink-100 text-ink-900'
                      : 'text-ink-600 hover:text-ink-900',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {tone === 'light' && pathname !== '/restaurants' && (
            <Link
              href="/restaurants"
              className="press hidden h-9 items-center gap-2 rounded-full bg-ink-100 px-3.5 text-sm text-ink-500 hover:bg-ink-200 sm:flex"
            >
              <Search className="h-4 w-4" /> Search restaurants
            </Link>
          )}
          <AccountMenu tone={tone} />
        </div>
      </div>
    </header>
  );
}
