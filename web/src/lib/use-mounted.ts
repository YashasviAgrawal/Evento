'use client';

import { useEffect, useState } from 'react';

/**
 * True only after this component has mounted on the client.
 *
 * Needed because auth state lives in localStorage, which the server cannot
 * see. A provider-level "hydrated" flag is not sufficient: with streaming
 * hydration a nested <Suspense> boundary hydrates *after* its parent's effects
 * have already run, so by the time the boundary hydrates the shared context
 * may already report a signed-in user — and React compares that against server
 * HTML rendered as signed-out.
 *
 * Because this hook's own effect cannot run before its own component's first
 * render, that first render always matches the server. Auth-dependent UI keyed
 * on it is therefore hydration-safe wherever it sits in the tree.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
