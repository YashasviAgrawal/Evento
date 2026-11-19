'use client';

import Link from 'next/link';
import { CalendarCheck2, ChevronRight, Crown, ExternalLink, LogOut, ReceiptText, Scale, ShieldCheck, Store, Ticket, UserRound, Wallet } from 'lucide-react';
import { useAuth } from '@tixit/session';
import { initials } from '@/lib/format';
import { EVENTS_URL } from '@/lib/urls';
import { usePartnerRestaurants } from '@/components/shell/account-menu';

export default function AccountPage() {
  const { user, loading, signOut } = useAuth();
  const { data: restaurants } = usePartnerRestaurants();

  if (loading) return <div className="container-page max-w-2xl py-10"><div className="skeleton h-40 rounded-3xl" /></div>;

  if (!user) {
    return (
      <div className="container-page max-w-2xl py-10">
        <div className="night rounded-[28px] p-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/10">
            <UserRound className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-xl font-extrabold">One Tixit account</h1>
          <p className="mt-1 text-sm text-ink-300">Sign in once — you’re signed in to Tixit Events and Dine-in.</p>
          <Link href="/auth/login?next=/account" className="press mt-5 inline-flex h-12 items-center rounded-2xl bg-white px-6 font-bold text-ink-900">
            Sign in or create account
          </Link>
        </div>
      </div>
    );
  }

  const row = 'flex items-center gap-3.5 p-4 transition hover:bg-ink-50';
  return (
    <div className="container-page max-w-2xl py-6 sm:py-10">
      <div className="flex items-center gap-4">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-bold text-white">
          {initials(user.fullName)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold tracking-tight">{user.fullName}</h1>
          <p className="truncate text-sm text-ink-500">{user.email}</p>
        </div>
      </div>

      <ul className="mt-6 divide-y divide-ink-100 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
        <li><Link href="/bookings" className={row}><CalendarCheck2 className="h-5 w-5 text-ink-400" /><span className="flex-1 font-semibold">Your plans</span><ChevronRight className="h-4 w-4 text-ink-300" /></Link></li>
        <li><Link href="/pass" className={row}><Crown className="h-5 w-5 text-brand-600" /><span className="flex-1 font-semibold">Tixit Pass</span><ChevronRight className="h-4 w-4 text-ink-300" /></Link></li>
        <li><Link href="/wallet" className={row}><Wallet className="h-5 w-5 text-ink-400" /><span className="flex-1 font-semibold">Wallet &amp; cashback</span><ChevronRight className="h-4 w-4 text-ink-300" /></Link></li>
        <li><Link href="/pay" className={row}><ReceiptText className="h-5 w-5 text-ink-400" /><span className="flex-1 font-semibold">Pay a bill</span><ChevronRight className="h-4 w-4 text-ink-300" /></Link></li>
        {restaurants && restaurants.length > 0 && (
          <li><Link href="/partner" className={row}><Store className="h-5 w-5 text-ink-400" /><span className="flex-1 font-semibold">Partner console</span><ChevronRight className="h-4 w-4 text-ink-300" /></Link></li>
        )}
      </ul>

      <h2 className="eyebrow mt-8 text-ink-400">Your Tixit account</h2>
      <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
        <li><a href={`${EVENTS_URL}/account/profile`} className={row}><UserRound className="h-5 w-5 text-ink-400" /><span className="flex-1 font-semibold">Profile, password &amp; privacy</span><ExternalLink className="h-4 w-4 text-ink-300" /></a></li>
        <li><a href={`${EVENTS_URL}/account/bookings`} className={row}><Ticket className="h-5 w-5 text-ink-400" /><span className="flex-1 font-semibold">Event tickets</span><ExternalLink className="h-4 w-4 text-ink-300" /></a></li>
      </ul>
      <p className="mt-2 px-1 text-xs text-ink-500">Same account on tixit.in — you’re already signed in there.</p>

      <h2 className="eyebrow mt-8 text-ink-400">Privacy &amp; help</h2>
      <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
        <li><Link href="/account/privacy" className={row}><ShieldCheck className="h-5 w-5 text-ink-400" /><span className="flex-1 font-semibold">Privacy, consents &amp; my data</span><ChevronRight className="h-4 w-4 text-ink-300" /></Link></li>
        <li><Link href="/grievance" className={row}><Scale className="h-5 w-5 text-ink-400" /><span className="flex-1 font-semibold">Raise a complaint</span><ChevronRight className="h-4 w-4 text-ink-300" /></Link></li>
      </ul>

      <button onClick={() => void signOut()} className="press mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-bold text-rose-600 ring-1 ring-inset ring-ink-200">
        <LogOut className="h-4 w-4" /> Sign out of Tixit
      </button>
      <p className="mt-2 text-center text-xs text-ink-400">Signs you out of Events and Dine-in on this device.</p>
    </div>
  );
}
