'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CmsAuthProvider, useCmsAuth } from '@/components/providers/cms-auth-provider';
import { CmsShell } from '@/components/cms/cms-shell';
import { Spinner } from '@/components/ui/index';

/**
 * Everything under /cms runs inside its own session context.
 *
 * `/cms/login` is inside this tree so that it can call `signIn`, but it must
 * not be behind the guard — that would be a redirect loop. So the guard is a
 * component the layout applies to every path except the login screen.
 */
export default function CmsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === '/cms/login';

  return (
    <CmsAuthProvider>
      {isLogin ? children : <CmsGuard>{children}</CmsGuard>}
    </CmsAuthProvider>
  );
}

/**
 * Client-side gate. Like the platform's `RequireAuth` this is a UX affordance,
 * not the security boundary — every /api/v1/cms endpoint authorises the request
 * itself. Its job is to avoid rendering a studio that would only fill with 401s.
 */
function CmsGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCmsAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/cms/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!user) return null;

  return <CmsShell>{children}</CmsShell>;
}
