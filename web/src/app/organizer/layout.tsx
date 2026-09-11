'use client';

import { usePathname } from 'next/navigation';
import { BarChart3, CalendarDays, LayoutDashboard, QrCode, Settings, Tag, Ticket, Wallet } from 'lucide-react';
import { RequireAuth } from '@/components/auth/require-auth';
import { DashboardShell, type NavItem } from '@/components/dashboard/shell';
import { useAuth } from '@/components/providers/auth-provider';
import { KycBanner } from '@/components/organizer/kyc-banner';
import { ButtonLink } from '@/components/ui/button';

const NAV: NavItem[] = [
  { href: '/organizer', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/organizer/events', label: 'My Events', icon: CalendarDays },
  { href: '/organizer/bookings', label: 'Bookings', icon: Ticket },
  { href: '/organizer/coupons', label: 'Coupons', icon: Tag },
  { href: '/organizer/scan', label: 'Scan Tickets', icon: QrCode },
  { href: '/organizer/reports', label: 'Reports', icon: BarChart3 },
  { href: '/organizer/kyc', label: 'Payout Details', icon: Wallet },
  { href: '/organizer/settings', label: 'Settings', icon: Settings },
];

export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The registration page is reachable by customers who want to become
  // organizers, so it must sit outside the organizer-role guard.
  if (pathname === '/organizer/register') return <>{children}</>;

  return (
    <RequireAuth roles={['organizer', 'admin']} fallbackMessage="Register as an organizer to access this dashboard.">
      <OrganizerChrome>{children}</OrganizerChrome>
    </RequireAuth>
  );
}

function OrganizerChrome({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <DashboardShell
      title="Organizer"
      subtitle={user?.organizer?.displayName ?? user?.fullName ?? ''}
      nav={NAV}
      actions={
        <ButtonLink href="/organizer/events/new" size="sm">
          New event
        </ButtonLink>
      }
    >
      <KycBanner />
      {children}
    </DashboardShell>
  );
}
