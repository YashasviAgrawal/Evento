import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/require-auth';
import { LivePass } from '@/components/pay/live-pass';

export const metadata: Metadata = { title: 'Your payment pass', robots: { index: false } };

export default async function BillPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <Suspense>
      <RequireAuth>
        <LivePass code={code} />
      </RequireAuth>
    </Suspense>
  );
}
