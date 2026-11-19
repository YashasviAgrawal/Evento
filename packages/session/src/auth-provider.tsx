'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';
import {
  bootSession,
  clearSession,
  endSession,
  getSessionUser,
  hasSessionHint,
  onCrossTabMessage,
  refreshSession,
  setSession,
  subscribe,
  updateSessionUser,
} from './session';
import type { SessionResponse, SessionUser } from './types';

/**
 * `signup` redeems the code that creates the account — registration parks the
 * details server-side and nothing exists until this succeeds. `verify_email`
 * confirms the address on an account that already exists.
 */
export type VerifyPurpose = 'signup' | 'verify_email';

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  role: 'customer' | 'organizer';
  organizerName?: string;
}

export interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  signInWithOtp: (email: string, code: string) => Promise<SessionUser>;
  /** Exchange a Google ID token for a session, creating the account if needed. */
  signInWithGoogle: (credential: string) => Promise<{ user: SessionUser; created: boolean }>;
  verifyEmail: (email: string, code: string, purpose?: VerifyPurpose) => Promise<SessionUser>;
  /** Starts a registration; the account exists once `verifyEmail` redeems the mailed code. */
  register: (input: RegisterInput) => Promise<{ email: string; devOtp?: string }>;
  signOut: (options?: { redirectTo?: string | null }) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * One account across every Tixit app.
 *
 * On mount the provider picks up any session started in *another* Tixit app
 * (see `bootSession`), and it re-checks when the tab regains focus: signing in
 * on www and switching to dine-in shows you signed in; signing out anywhere
 * signs you out here too.
 */
export function AuthProvider({ children, signedOutPath = '/' }: { children: ReactNode; signedOutPath?: string }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => subscribe(setUser), []);

  useEffect(() => {
    let cancelled = false;
    bootSession().finally(() => {
      if (!cancelled) {
        setUser(getSessionUser());
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Another tab of this app signed in or out.
  useEffect(
    () =>
      onCrossTabMessage((message) => {
        if (message === 'signed-out') clearSession({ announce: false });
        else void refreshSession();
      }),
    [],
  );

  // Another Tixit app (another origin) signed in or out: the shared hint cookie tells us.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      const signedInHere = Boolean(getSessionUser());
      const signedInSomewhere = hasSessionHint();
      if (signedInHere && !signedInSomewhere) clearSession({ announce: false });
      else if (!signedInHere && signedInSomewhere) void refreshSession();
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<SessionResponse>('/auth/login', { email, password });
    return setSession(data);
  }, []);

  const signInWithOtp = useCallback(async (email: string, code: string) => {
    const { data } = await api.post<SessionResponse>('/auth/otp/verify', { email, code, purpose: 'login' });
    return setSession(data);
  }, []);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const { data } = await api.post<SessionResponse & { created: boolean }>('/auth/google', { credential });
    return { user: setSession(data), created: data.created };
  }, []);

  const verifyEmail = useCallback(async (email: string, code: string, purpose: VerifyPurpose = 'signup') => {
    const { data } = await api.post<SessionResponse>('/auth/otp/verify', { email, code, purpose });
    return setSession(data);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const { data } = await api.post<{ email: string; devOtp?: string }>('/auth/register', input);
    return { email: data.email, devOtp: data.devOtp };
  }, []);

  const signOut = useCallback(
    async (options: { redirectTo?: string | null } = {}) => {
      await endSession();
      const target = options.redirectTo === undefined ? signedOutPath : options.redirectTo;
      if (target !== null) {
        router.push(target);
        router.refresh();
      }
    },
    [router, signedOutPath],
  );

  const refreshUser = useCallback(async () => {
    if (!getSessionUser()) {
      await bootSession();
      return;
    }
    try {
      const { data } = await api.get<SessionUser>('/auth/me');
      updateSessionUser(data);
    } catch {
      // A 401 here already cleared the session inside the API client.
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signIn, signInWithOtp, signInWithGoogle, verifyEmail, register, signOut, refreshUser }),
    [user, loading, signIn, signInWithOtp, signInWithGoogle, verifyEmail, register, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
