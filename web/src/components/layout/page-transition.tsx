'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Replays a soft entrance animation on every navigation.
 *
 * The `key` is what does the work: changing it makes React discard and remount
 * the subtree, which restarts the CSS animation. Without it the animation
 * would run only once, on first mount, because the wrapper element itself
 * persists across route changes.
 *
 * Motion is suppressed entirely for users who ask for reduced motion — the
 * global rule in globals.css collapses the duration.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <main key={pathname} className="flex-1 animate-enter">
      {children}
    </main>
  );
}
