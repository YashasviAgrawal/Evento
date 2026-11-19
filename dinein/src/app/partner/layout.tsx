import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/require-auth';

export const metadata: Metadata = { title: 'Partner console', robots: { index: false } };

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <RequireAuth>{children}</RequireAuth>
    </Suspense>
  );
}
