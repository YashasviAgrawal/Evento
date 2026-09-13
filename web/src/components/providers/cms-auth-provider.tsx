'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { cmsApi, cmsTokenStore } from '@/lib/cms-api';
import type { CmsUser } from '@/lib/types';

/**
 * The CMS session, held entirely apart from the storefront's `AuthProvider`.
 *
 * Both can be active in the same browser at once and neither knows about the
 * other: signing out of the site leaves the CMS session alone, and vice versa.
 */
interface CmsAuthContextValue {
  user: CmsUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<CmsUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CmsAuthContext = createContext<CmsAuthContextValue | null>(null);

interface CmsSessionResponse {
  user: CmsUser;
  accessToken: string;
  sessionToken: string;
}

export function CmsAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CmsUser | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * localStorage does not exist on the server, so the first client render must
   * match the server's signed-out tree or React reports a hydration mismatch.
   * This flips in an effect, which cannot run before that first render.
   */
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setHydrated(true);
  }, []);

  const loadSession = useCallback(async () => {
    // Show the cached account immediately so a refresh does not flash the
    // login screen while /auth/me is in flight.
    const cached = cmsTokenStore.getUser<CmsUser>();
    if (cached) setUser(cached);

    if (!cmsTokenStore.access) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const { data } = await cmsApi.get<CmsUser>('/auth/me');
      setUser(data);
      cmsTokenStore.setUser(data);
    } catch {
      cmsTokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data } = await cmsApi.post<CmsSessionResponse>('/auth/login', { email, password });
    cmsTokenStore.set(data.accessToken, data.sessionToken);
    cmsTokenStore.setUser(data.user);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await cmsApi.post('/auth/logout', { sessionToken: cmsTokenStore.session });
    } catch {
      // Clearing the session locally has to succeed even if the API call does not.
    }
    cmsTokenStore.clear();
    setUser(null);
    router.replace('/cms/login');
  }, [router]);

  const value = useMemo(
    () => ({
      user: hydrated ? user : null,
      loading: !hydrated || loading,
      signIn,
      signOut,
      refresh: loadSession,
    }),
    [hydrated, user, loading, signIn, signOut, loadSession],
  );

  return <CmsAuthContext.Provider value={value}>{children}</CmsAuthContext.Provider>;
}

export function useCmsAuth(): CmsAuthContextValue {
  const context = useContext(CmsAuthContext);
  if (!context) throw new Error('useCmsAuth must be used inside <CmsAuthProvider>');
  return context;
}
