'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  Ticket,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { SearchBox } from '@/components/search/search-box';
import { useMounted } from '@/lib/use-mounted';
import { Button, ButtonLink } from '@/components/ui/button';
import { cn, initials } from '@/lib/format';

const NAV_LINKS = [
  { href: '/events', label: 'All Events' },
  { href: '/events?when=today', label: 'Today' },
  { href: '/events?when=weekend', label: 'This Weekend' },
  { href: '/events?price=free', label: 'Free' },
];

export function Navbar() {
  const { user, signOut, loading } = useAuth();
  // Until this component has mounted, render the same signed-out shell the
  // server produced — see useMounted for why a provider-level flag is not enough.
  const mounted = useMounted();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // Close the account dropdown on an outside click or Escape.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAccountOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Any navigation should dismiss the mobile sheet.
  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  const dashboardHref = user?.role === 'admin' ? '/admin' : user?.role === 'organizer' ? '/organizer' : null;

  return (
    <header className="sticky top-0 z-50 border-b border-ink-200 bg-white/90 backdrop-blur-md">
      <div className="container-page">
        <div className="flex h-16 items-center gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Evento home">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
              <Ticket className="h-4.5 w-4.5" strokeWidth={2.5} />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-ink-900">Evento</span>
          </Link>

          <div className="hidden min-w-0 flex-1 md:block">
            <SearchBox
              className="max-w-md"
              placeholder="Search events, artists, venues…"
              initialValue={searchParams.get('q') ?? ''}
            />
          </div>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {!mounted || loading ? (
              <div className="h-9 w-24 animate-pulse rounded-lg bg-ink-100" />
            ) : user ? (
              <div className="relative" ref={accountRef}>
                <button
                  onClick={() => setAccountOpen((open) => !open)}
                  className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition hover:bg-ink-100"
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
                    {initials(user.fullName)}
                  </span>
                  <span className="hidden max-w-[7rem] truncate text-sm font-medium text-ink-800 sm:block">
                    {user.fullName.split(' ')[0]}
                  </span>
                  <ChevronDown className={cn('h-4 w-4 text-ink-400 transition', accountOpen && 'rotate-180')} />
                </button>

                {accountOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-60 animate-fade-up overflow-hidden rounded-xl border border-ink-200 bg-white py-1.5 shadow-lift"
                  >
                    <div className="border-b border-ink-100 px-3.5 py-2.5">
                      <p className="truncate text-sm font-semibold text-ink-900">{user.fullName}</p>
                      <p className="truncate text-xs text-ink-500">{user.email}</p>
                    </div>

                    <MenuLink href="/account/bookings" icon={<CalendarDays className="h-4 w-4" />}>
                      My Bookings
                    </MenuLink>
                    <MenuLink href="/account/profile" icon={<UserIcon className="h-4 w-4" />}>
                      Profile
                    </MenuLink>
                    {dashboardHref && (
                      <MenuLink
                        href={dashboardHref}
                        icon={user.role === 'admin' ? <Shield className="h-4 w-4" /> : <LayoutDashboard className="h-4 w-4" />}
                      >
                        {user.role === 'admin' ? 'Admin Console' : 'Organizer Dashboard'}
                      </MenuLink>
                    )}
                    {user.role === 'customer' && (
                      <MenuLink href="/organizer/register" icon={<LayoutDashboard className="h-4 w-4" />}>
                        List your event
                      </MenuLink>
                    )}

                    <div className="my-1 border-t border-ink-100" />
                    <button
                      onClick={() => void signOut()}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
                      role="menuitem"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <ButtonLink href="/auth/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
                  Sign in
                </ButtonLink>
                <ButtonLink href="/auth/register" size="sm">
                  Get started
                </ButtonLink>
              </>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {menuOpen && (
          <div className="animate-fade-up border-t border-ink-200 py-3 lg:hidden">
            <div className="mb-3 md:hidden">
              <SearchBox
                placeholder="Search events…"
                initialValue={searchParams.get('q') ?? ''}
                onNavigate={() => setMenuOpen(false)}
              />
            </div>
            <nav className="grid gap-0.5" aria-label="Mobile">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}

function MenuLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-700 transition hover:bg-ink-100"
    >
      <span className="text-ink-400">{icon}</span>
      {children}
    </Link>
  );
}
