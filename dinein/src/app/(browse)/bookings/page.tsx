import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/require-auth';
import { Plans } from './plans';

export const metadata: Metadata = { title: 'Your plans', robots: { index: false } };

export default function BookingsPage() {
  return (
    <div className="container-page max-w-2xl py-6 sm:py-10">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Your plans</h1>
      <p className="mt-1 text-sm text-ink-500">Tables you’ve booked and bills you’ve paid on Tixit.</p>
      <Suspense>
        <RequireAuth>
          <Plans />
        </RequireAuth>
      </Suspense>
    </div>
  );
}
