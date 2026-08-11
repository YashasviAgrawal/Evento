'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/format';
import { Button } from '@/components/ui/button';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  exact?: boolean;
}

/**
 * Shared chrome for the organizer and admin consoles: a dark sidebar on
 * desktop, a slide-over on mobile.
 */
export function DashboardShell({
  title,
  subtitle,
  nav,
  accent = 'brand',
  children,
  actions,
}: {
  title: string;
  subtitle: string;
  nav: NavItem[];
  accent?: 'brand' | 'violet';
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const accentClass = accent === 'violet' ? 'bg-violet-600' : 'bg-brand-600';

  function isActive(item: NavItem): boolean {
    return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  const navList = (
    <nav className="space-y-1" aria-label={title}>
      {nav.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
              active ? `${accentClass} text-white` : 'text-ink-300 hover:bg-ink-800 hover:text-white',
            )}
          >
            <item.icon className="h-4.5 w-4.5 shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={cn(
                  'grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-bold',
                  active ? 'bg-white/25 text-white' : 'bg-brand-600 text-white',
                )}
              >
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 bg-ink-950 p-4 lg:block">
        <div className="mb-6 px-3 pt-2">
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="mt-0.5 truncate text-xs text-ink-400">{subtitle}</p>
        </div>
        {navList}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={`${title} menu`}>
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-fade-up overflow-y-auto bg-ink-950 p-4">
            <div className="mb-6 flex items-start justify-between px-3 pt-2">
              <div>
                <p className="text-sm font-bold text-white">{title}</p>
                <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-ink-400 hover:text-white" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {navList}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1 bg-ink-50">
        <div className="flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-bold text-ink-900">{title}</span>
          <div className="ml-auto">{actions}</div>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </div>
    </div>
  );
}

/** Page header used inside the dashboard content area. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'brand';
}) {
  const tones = {
    default: 'text-ink-900',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    brand: 'text-brand-600',
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
        {icon && <span className="text-ink-300">{icon}</span>}
      </div>
      <p className={cn('mt-2 text-2xl font-extrabold tabular-nums', tones[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
