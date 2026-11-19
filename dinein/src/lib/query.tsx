'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, useAuth } from '@tixit/session';

/**
 * One query cache for the app. When the signed-in account changes — sign-out
 * here or in another Tixit app, or a different person signing in — every
 * cached response is dropped, so nobody ever sees the previous account's
 * bookings for a frame.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ResetOnAccountChange client={client} />
      {children}
    </QueryClientProvider>
  );
}

function ResetOnAccountChange({ client }: { client: QueryClient }) {
  const { user, loading } = useAuth();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (loading) return;
    const current = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== current) client.clear();
    previous.current = current;
  }, [client, user, loading]);
  return null;
}
