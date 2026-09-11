'use client';

import {
  BarChart3,
  CalendarCheck,
  Newspaper,
  RotateCcw,
  Settings,
  ShieldCheck,
  Tag,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { RequireAuth } from '@/components/auth/require-auth';
import { DashboardShell, type NavItem } from '@/components/dashboard/shell';

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: BarChart3, exact: true },
  { href: '/admin/events', label: 'Event Approvals', icon: CalendarCheck },
  { href: '/admin/organizers', label: 'Organizers', icon: ShieldCheck },
  { href: '/admin/analytics', label: 'Organizer Analytics', icon: TrendingUp },
  { href: '/admin/payments', label: 'Payouts & KYC', icon: Wallet },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/coupons', label: 'Coupons', icon: Tag },
  { href: '/admin/refunds', label: 'Refunds', icon: RotateCcw },
  { href: '/admin/blog', label: 'Blog', icon: Newspaper },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth roles={['admin']} fallbackMessage="The admin console is restricted to platform administrators.">
      <DashboardShell title="Admin Console" subtitle="Platform operations" nav={NAV} accent="violet">
        {children}
      </DashboardShell>
    </RequireAuth>
  );
}
