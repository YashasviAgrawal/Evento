'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useMounted } from '@/lib/use-mounted';
import { Spinner, EmptyState } from '@/components/ui/index';
import { ButtonLink } from '@/components/ui/button';
import type { Role } from '@/lib/types';

/**
 * Client-side route guard.
 *
 * This is a UX affordance, not a security boundary — every protected endpoint
 * is independently authorised on the server. Its job is to avoid rendering a
 * dashboard shell that would only fill with 403s.
 */
export function RequireAuth({
  children,
  roles,
  fallbackMessage,
}: {
  children: React.ReactNode;
  roles?: Role[];
  fallbackMessage?: string;
}) {
  const { user, loading } = useAuth();
  const mounted = useMounted();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (mounted && !loading && !user) {
      router.replace(`/auth/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [mounted, loading, user, router, pathname]);

  if (!mounted || loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!user) return null;

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon={<ShieldAlert className="h-10 w-10" />}
          title="You don’t have access to this area"
          description={fallbackMessage ?? `This section is for ${roles.join(' and ')} accounts.`}
          action={<ButtonLink href="/">Go home</ButtonLink>}
        />
      </div>
    );
  }

  return <>{children}</>;
}
