'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { TabBar } from './tab-bar';

/**
 * Immersive screens — paying, the live pass at the table, signing in, the
 * partner console — get the whole viewport. Everything else gets the tab bar.
 */
const IMMERSIVE = [/^\/pay\/.+/, /^\/bills\/.+/, /^\/split\/.+/, /^\/auth\//, /^\/partner/, /^\/admin/];
/** Restaurant pages carry their own action dock (Book · Pay bill) instead of the tab bar. */
const OWN_DOCK = [/^\/r\/.+/];

export function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const immersive = IMMERSIVE.some((pattern) => pattern.test(pathname));
  const ownDock = OWN_DOCK.some((pattern) => pattern.test(pathname));
  return (
    <>
      <div className={immersive ? '' : 'pb-24 md:pb-0'}>{children}</div>
      {!immersive && !ownDock && <TabBar />}
    </>
  );
}
