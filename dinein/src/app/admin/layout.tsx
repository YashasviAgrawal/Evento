import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/require-auth';
import { AdminShell } from '@/components/admin/admin-shell';

export const metadata: Metadata = { title: 'Dine-in admin', robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <RequireAuth>
        <AdminShell>{children}</AdminShell>
      </RequireAuth>
    </Suspense>
  );
}
