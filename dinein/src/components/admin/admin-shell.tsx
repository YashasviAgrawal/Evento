'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, LogOut, ShieldAlert, Store } from 'lucide-react';
import { useAuth } from '@tixit/session';
import { cn } from '@/lib/format';
import { EVENTS_URL } from '@/lib/urls';
import { EmptyState } from '@/components/ui/feedback';

export const STATUS_STYLE: Record<string, string> = {
  live: 'bg-save-50 text-save-700',
  pending_review: 'bg-amber-50 text-amber-700',
  paused: 'bg-sky-50 text-sky-700',
  draft: 'bg-ink-100 text-ink-600',
  delisted: 'bg-rose-50 text-rose-700',
};

export const STATUS_LABEL: Record<string, string> = {
  live: 'Live',
  pending_review: 'In review',
  paused: 'Paused',
  draft: 'Draft',
  delisted: 'Delisted',
};

/**
 * Dine-in operations for platform admins. The same night sidebar as the
 * partner console, with a link across to the events admin on www — one
 * account, so moving between them never asks for a password.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const pathname = usePathname();

  if (user?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState icon={ShieldAlert} title="Admins only" body="This area is for the Tixit operations team." />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-ink-50 md:grid md:grid-cols-[232px_1fr]">
      <aside className="night sticky top-0 hidden h-dvh flex-col p-4 md:flex">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/brand/wordmark-red.png" alt="Tixit" width={474} height={175} className="h-6 w-auto brightness-0 invert" />
          <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-brand-300">Admin</span>
        </Link>
        <nav className="mt-8 space-y-1" aria-label="Admin">
          <Link
            href="/admin"
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold',
              pathname.startsWith('/admin') ? 'bg-white/10 text-white' : 'text-ink-300 hover:text-white',
            )}
          >
            <Store className="h-4 w-4" /> Restaurants
          </Link>
          <a href={`${EVENTS_URL}/admin`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-300 hover:text-white">
            <ExternalLink className="h-4 w-4" /> Events admin
          </a>
        </nav>
        <button onClick={() => void signOut()} className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink-400 hover:text-white">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </aside>
      <div className="min-w-0">
        <header className="night flex items-center justify-between px-4 py-3 md:hidden">
          <p className="font-bold">Tixit Admin · Dine-in</p>
          <Link href="/admin" className="glass rounded-full px-3 py-1.5 text-xs font-bold">Restaurants</Link>
        </header>
        {children}
      </div>
    </div>
  );
}
