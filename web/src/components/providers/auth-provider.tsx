'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from '@/lib/api';
import type { User } from '@/lib/types';

/**
 * `signup` redeems the code that creates the account — registration parks the
 * details server-side and nothing exists until this succeeds. `verify_email`
 * confirms the address on an account that already exists.
 */
export type VerifyPurpose = 'signup' | 'verify_email';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signInWithOtp: (email: string, code: string) => Promise<User>;
  verifyEmail: (email: string, code: string, purpose?: VerifyPurpose) => Promise<User>;
  register: (input: {
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    role: 'customer' | 'organizer';
    organizerName?: string;
  }) => Promise<{ email: string; devOtp?: string }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface SessionResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Hydrate from localStorage so a refresh does not flash the signed-out state
  // before the /me round trip lands.
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * The server has no localStorage, so it always renders the signed-out tree.
   * `hydrated` stays false through the client's first render — guaranteed,
   * since the effect that flips it cannot run earlier — which keeps that first
   * render byte-identical to the server's and avoids a hydration mismatch.
   * Consumers see `loading: true` until the session has actually resolved.
   */
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setHydrated(true);
  }, []);

  const loadSession = useCallback(async () => {
    const cached = tokenStore.getUser<User>();
    if (cached) setUser(cached);

    if (!tokenStore.access) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const { data } = await api.get<User>('/auth/me');
      setUser(data);
      tokenStore.setUser(data);
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const persist = useCallback((session: SessionResponse) => {
    tokenStore.set(session.accessToken, session.refreshToken);
    tokenStore.setUser(session.user);
    setUser(session.user);
    return session.user;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<SessionResponse>('/auth/login', { email, password });
      return persist(data);
    },
    [persist],
  );

  const signInWithOtp = useCallback(
    async (email: string, code: string) => {
      const { data } = await api.post<SessionResponse>('/auth/otp/verify', { email, code, purpose: 'login' });
      return persist(data);
    },
    [persist],
  );

  /**
   * Redeem the code mailed at registration. The API answers with a session in
   * both flows, so persisting it signs in the account that was just created
   * (signup) or refreshes the cached user with `emailVerified: true`.
   */
  const verifyEmail = useCallback(
    async (email: string, code: string, purpose: VerifyPurpose = 'signup') => {
      const { data } = await api.post<SessionResponse>('/auth/otp/verify', { email, code, purpose });
      return persist(data);
    },
    [persist],
  );

  /**
   * Starts a registration — it does not create an account. The server holds
   * the details and mails a code; the account exists only once `verifyEmail`
   * redeems it, so there is no session to persist here.
   */
  const register = useCallback(
    async (input: Parameters<AuthContextValue['register']>[0]) => {
      const { data } = await api.post<{ email: string; devOtp?: string }>('/auth/register', input);
      return { email: data.email, devOtp: data.devOtp };
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.refresh });
    } catch {
      // Signing out locally must succeed even if the API call does not.
    }
    tokenStore.clear();
    setUser(null);
    router.push('/');
    router.refresh();
  }, [router]);

  const value = useMemo(
    () => ({
      user: hydrated ? user : null,
      loading: !hydrated || loading,
      signIn,
      signInWithOtp,
      verifyEmail,
      register,
      signOut,
      refreshUser: loadSession,
    }),
    [hydrated, user, loading, signIn, signInWithOtp, verifyEmail, register, signOut, loadSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
