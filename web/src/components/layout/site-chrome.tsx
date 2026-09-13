'use client';

import { usePathname } from 'next/navigation';

/**
 * Hides the public navbar and footer on the CMS.
 *
 * /cms is a separate application with its own sign-in and its own chrome, so
 * framing it with the storefront's header — which offers a "Sign in" that logs
 * into a completely different account space — would be actively misleading.
 *
 * This wrapper exists instead of a `(site)` route group because the group
 * would mean relocating every existing route to buy the same result.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/cms' || pathname.startsWith('/cms/')) return null;
  return <>{children}</>;
}
