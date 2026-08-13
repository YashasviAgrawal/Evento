'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

/**
 * Catches render and data-fetching failures anywhere under the root layout.
 * Without this, a single failed request shows the user Next.js's raw error
 * page — unacceptable on a site that takes payments.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with your error reporter (Sentry et al) when one is wired up.
    console.error('Unhandled application error:', error);
  }, [error]);

  return <ErrorState error={error} onRetry={reset} />;
}
