import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/require-auth';
import { ReservationDetail } from './reservation-detail';

export const metadata: Metadata = { title: 'Your booking', robots: { index: false } };

export default async function ReservationPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <div className="container-page max-w-2xl py-4 sm:py-8">
      <Suspense>
        <RequireAuth>
          <ReservationDetail code={code} />
        </RequireAuth>
      </Suspense>
    </div>
  );
}
