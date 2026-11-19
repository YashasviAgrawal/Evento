'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@tixit/session';
import { Spinner } from '@/components/ui/feedback';

/** Renders children for a signed-in user; otherwise sends them to sign in and back. */
export function RequireAuth({ children, reason }: { children: ReactNode; reason?: string }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    if (loading || user) return;
    const here = params.size ? `${pathname}?${params}` : pathname;
    router.replace(`/auth/login?next=${encodeURIComponent(here)}${reason ? `&reason=${reason}` : ''}`);
  }, [loading, user, router, pathname, params, reason]);

  if (!user) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Spinner />
      </div>
    );
  }
  return <>{children}</>;
}
