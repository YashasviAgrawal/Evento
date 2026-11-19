'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CalendarCheck2, ChevronDown, ExternalLink, LogOut, Store, Ticket, User } from 'lucide-react';
import { useAuth } from '@tixit/session';
import { useQuery } from '@tanstack/react-query';
import { api } from '@tixit/session';
import { cn, initials } from '@/lib/format';
import { EVENTS_URL } from '@/lib/urls';
import type { PartnerRestaurant } from '@/lib/types';

export function usePartnerRestaurants() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['partner-restaurants', user?.id],
    queryFn: async () => (await api.get<PartnerRestaurant[]>('/partner/restaurants')).data,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
}

export function AccountMenu({ tone = 'light' }: { tone?: 'light' | 'night' }) {
  const { user, loading, signOut } = useAuth();
  const { data: restaurants } = usePartnerRestaurants();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (loading) return <div className={cn('h-9 w-9 rounded-full', tone === 'night' ? 'bg-white/10' : 'skeleton')} />;

  if (!user) {
    return (
      <Link
        href="/auth/login"
        className={cn(
          'press inline-flex h-9 items-center rounded-full px-4 text-sm font-bold',
          tone === 'night' ? 'bg-white text-ink-900' : 'bg-ink-900 text-white hover:bg-ink-800',
        )}
      >
        Sign in
      </Link>
    );
  }

  const item = 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50';
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'press flex items-center gap-1.5 rounded-full p-0.5 pr-2',
          tone === 'night' ? 'glass text-white' : 'bg-white ring-1 ring-inset ring-ink-200 hover:ring-ink-300',
        )}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
          {initials(user.fullName)}
        </span>
        <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-64 animate-enter rounded-2xl border border-ink-200 bg-white p-2 text-ink-900 shadow-lift"
        >
          <div className="px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-bold">{user.fullName}</p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-ink-100" />
          <Link href="/bookings" className={item} onClick={() => setOpen(false)}>
            <CalendarCheck2 className="h-4 w-4 text-ink-400" /> Your plans
          </Link>
          {restaurants && restaurants.length > 0 && (
            <Link href="/partner" className={item} onClick={() => setOpen(false)}>
              <Store className="h-4 w-4 text-ink-400" /> Partner console
              <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">
                {restaurants.length}
              </span>
            </Link>
          )}
          <a href={`${EVENTS_URL}/account/bookings`} className={item}>
            <Ticket className="h-4 w-4 text-ink-400" /> Event tickets
            <ExternalLink className="ml-auto h-3.5 w-3.5 text-ink-300" />
          </a>
          <a href={`${EVENTS_URL}/account/profile`} className={item}>
            <User className="h-4 w-4 text-ink-400" /> Tixit account
            <ExternalLink className="ml-auto h-3.5 w-3.5 text-ink-300" />
          </a>
          <div className="my-1 h-px bg-ink-100" />
          <button onClick={() => void signOut()} className={cn(item, 'w-full text-rose-600 hover:bg-rose-50')}>
            <LogOut className="h-4 w-4" /> Sign out of Tixit
          </button>
        </div>
      )}
    </div>
  );
}
