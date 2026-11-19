import Link from 'next/link';
import { EVENTS_URL } from '@/lib/urls';
import { cn } from '@/lib/format';

/**
 * Events | Dine-in. The single control that tells people this is one Tixit —
 * same account, signed in on both.
 */
export function AppSwitcher({ tone = 'light', className }: { tone?: 'light' | 'night'; className?: string }) {
  const base = 'rounded-full px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap';
  return (
    <nav
      aria-label="Tixit apps"
      className={cn(
        'inline-flex items-center rounded-full p-1',
        tone === 'night' ? 'glass' : 'bg-ink-100 ring-1 ring-inset ring-ink-200/70',
        className,
      )}
    >
      <a
        href={EVENTS_URL}
        className={cn(base, tone === 'night' ? 'text-ink-300 hover:text-white' : 'text-ink-500 hover:text-ink-900')}
      >
        Events
      </a>
      <Link href="/" aria-current="page" className={cn(base, 'bg-white text-ink-900 shadow-card')}>
        Dine-in
      </Link>
    </nav>
  );
}
