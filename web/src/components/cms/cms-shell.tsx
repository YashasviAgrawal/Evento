'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, FolderTree, LayoutDashboard, LogOut, Menu, Users, X } from 'lucide-react';
import { useCmsAuth } from '@/components/providers/cms-auth-provider';
import { Button } from '@/components/ui/button';
import { cn, initials } from '@/lib/format';

interface CmsNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  /** Account administration is for CMS admins; content is for everyone. */
  adminOnly?: boolean;
}

const NAV: CmsNavItem[] = [
  { href: '/cms', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/cms/posts', label: 'Articles', icon: FileText },
  { href: '/cms/categories', label: 'Categories', icon: FolderTree },
  { href: '/cms/users', label: 'Accounts', icon: Users, adminOnly: true },
];

/**
 * Chrome for the CMS.
 *
 * Visually distinct from the admin console on purpose — a slate sidebar rather
 * than the platform's violet — because the two are reached with different
 * credentials and confusing them is the mistake worth designing against.
 */
export function CmsShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useCmsAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items = NAV.filter((item) => !item.adminOnly || user?.role === 'admin');

  function isActive(item: CmsNavItem): boolean {
    return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="mb-6 px-3 pt-2">
        <p className="text-sm font-bold text-white">Content Studio</p>
        <p className="mt-0.5 truncate text-xs text-ink-400">Blog &amp; editorial</p>
      </div>

      <nav className="flex-1 space-y-1" aria-label="Content Studio">
        {items.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                active ? 'bg-emerald-600 text-white' : 'text-ink-300 hover:bg-ink-800 hover:text-white',
              )}
            >
              <item.icon className="h-4.5 w-4.5 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="mt-4 border-t border-ink-800 pt-4">
          <Link
            href="/cms/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-ink-800"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white">
              {initials(user.fullName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{user.fullName}</span>
              <span className="block truncate text-xs capitalize text-ink-400">{user.role}</span>
            </span>
          </Link>
          <button
            onClick={() => void signOut()}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-300 transition hover:bg-ink-800 hover:text-white"
          >
            <LogOut className="h-4.5 w-4.5 shrink-0" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 bg-ink-950 p-4 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Content Studio menu">
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-fade-up overflow-y-auto bg-ink-950 p-4">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 text-ink-400 hover:text-white"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1 bg-ink-50">
        <div className="flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-bold text-ink-900">Content Studio</span>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </div>
    </div>
  );
}
