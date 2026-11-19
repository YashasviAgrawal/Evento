'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react';
import { ApiError, GoogleButton, api, useAuth } from '@tixit/session';
import { cn } from '@/lib/format';
import { safeNext } from '@/lib/urls';
import { Spinner } from '@/components/ui/feedback';
import { Wordmark } from '@/components/shell/site-header';

type Mode = 'password' | 'code' | 'phone' | 'signup';
type Stage = 'form' | 'verify';

const REASONS: Record<string, string> = {
  book: 'Sign in to confirm your table',
  pay: 'Sign in to pay — your bill is saved',
};

/**
 * The shared Tixit sign-in. The same account, the same methods and the same
 * session as www.tixit.in: whichever app someone signs in on, they are signed
 * in on both.
 */
export function AuthScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'), '/');
  const reason = REASONS[params.get('reason') ?? ''];
  const { user, loading, signIn, signInWithOtp, signInWithPhoneOtp, signInWithGoogle, register, verifyEmail } = useAuth();

  const [mode, setMode] = useState<Mode>('password');
  const [stage, setStage] = useState<Stage>('form');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (perhaps on tixit.in a moment ago): go straight on.
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, router, next]);

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PHONE_NOT_REGISTERED') {
        setError(err.message);
      } else if (err instanceof ApiError && err.code === 'EMAIL_NOT_REGISTERED') {
        setMode('signup');
        setError('No Tixit account uses that email yet — create one below.');
      } else {
        setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (stage === 'verify') {
      void run(async () => {
        if (mode === 'signup') await verifyEmail(email, code, 'signup');
        else if (mode === 'phone') await signInWithPhoneOtp(phone, code);
        else await signInWithOtp(email, code);
        router.replace(next);
      });
      return;
    }
    if (mode === 'password') {
      void run(async () => {
        await signIn(email, password);
        router.replace(next);
      });
    } else if (mode === 'phone') {
      void run(async () => {
        const { data } = await api.post<{ devOtp?: string }>('/auth/phone/otp/request', { phone });
        setDevCode(data.devOtp ?? null);
        setStage('verify');
      });
    } else if (mode === 'code') {
      void run(async () => {
        const { data } = await api.post<{ devOtp?: string }>('/auth/otp/request', { email, purpose: 'login' });
        setDevCode(data.devOtp ?? null);
        setStage('verify');
      });
    } else {
      void run(async () => {
        const result = await register({ fullName, email, password, phone: phone || undefined, role: 'customer' });
        setDevCode(result.devOtp ?? null);
        setStage('verify');
      });
    }
  };

  const switchMode = (value: Mode) => {
    setMode(value);
    setStage('form');
    setError(null);
    setCode('');
  };

  if (loading || user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel — desktop only */}
      <aside className="night hidden flex-col justify-between p-12 lg:flex">
        <Wordmark tone="night" />
        <div>
          <h2 className="max-w-md text-5xl font-extrabold leading-[1.05] tracking-tight">
            One account.
            <br />
            <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">Every night out.</span>
          </h2>
          <ul className="mt-8 space-y-3 text-ink-300">
            {['Sign in once — Tixit Events and Dine-in both know it’s you', 'Book tables, pay bills, keep every saving', 'Your tickets and tables, side by side'].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600/30 text-brand-300">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-ink-500">Protected by encrypted, HttpOnly sessions shared only across tixit.in.</p>
      </aside>

      <main className="flex flex-col px-5 pb-10 pt-4 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <span className="lg:hidden">
            <Wordmark />
          </span>
          <Link href={next} className="press grid h-10 w-10 place-items-center rounded-full bg-white ring-1 ring-ink-200" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </div>

        <div className="mx-auto w-full max-w-sm flex-1 pt-8 sm:pt-16">
          {stage === 'verify' ? (
            <>
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
                <Mail className="h-7 w-7" />
              </span>
              <h1 className="mt-5 text-2xl font-extrabold tracking-tight">{mode === 'phone' ? 'Check your messages' : 'Check your inbox'}</h1>
              <p className="mt-1.5 text-sm text-ink-500">
                We sent a 6-digit code to <b className="text-ink-800">{mode === 'phone' ? phone : email}</b>.
              </p>
            </>
          ) : (
            <>
              {reason && (
                <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">
                  <ShieldCheck className="h-3.5 w-3.5" /> {reason}
                </p>
              )}
              <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
                {mode === 'signup' ? 'Create your Tixit account' : 'Welcome back'}
              </h1>
              <p className="mt-1.5 text-sm text-ink-500">
                {mode === 'signup' ? 'One account for Tixit Events and Dine-in.' : 'Use your Tixit account — the same one as tixit.in.'}
              </p>
            </>
          )}

          {stage === 'form' && (
            <>
              <div className="mt-6">
                <GoogleButton
                  dividerLabel="or use email"
                  onCredential={(credential) =>
                    run(async () => {
                      await signInWithGoogle(credential);
                      router.replace(next);
                    })
                  }
                />
              </div>

              <div className="mt-5 grid grid-cols-4 rounded-2xl bg-ink-100 p-1 text-[13px] font-bold" role="tablist">
                {(
                  [
                    ['password', 'Password'],
                    ['phone', 'Phone'],
                    ['code', 'Email code'],
                    ['signup', 'Sign up'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={mode === value}
                    onClick={() => switchMode(value)}
                    className={cn('rounded-xl py-2 transition', mode === value ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          <form onSubmit={submit} className="mt-5 space-y-3.5">
            {stage === 'verify' ? (
              <div>
                <label htmlFor="code" className="label">
                  Verification code
                </label>
                <input
                  id="code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="input num h-14 text-center text-2xl font-bold tracking-[0.5em]"
                  autoFocus
                  required
                />
                {devCode && <p className="mt-2 text-xs text-ink-400">Development mode — your code is {devCode}</p>}
              </div>
            ) : (
              <>
                {mode === 'signup' && (
                  <div>
                    <label htmlFor="name" className="label">Full name</label>
                    <input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" autoComplete="name" required />
                  </div>
                )}
                {mode === 'phone' ? (
                  <div>
                    <label htmlFor="mobile" className="label">Mobile number</label>
                    <div className="flex items-center gap-2">
                      <span className="grid h-[50px] shrink-0 place-items-center rounded-xl bg-ink-100 px-3 text-sm font-bold text-ink-600">+91</span>
                      <input
                        id="mobile"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, '').slice(0, 10))}
                        className="input"
                        autoComplete="tel-national"
                        inputMode="numeric"
                        placeholder="98765 43210"
                        required
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-ink-400">For accounts with this number on file. We’ll text you a code.</p>
                  </div>
                ) : (
                <div>
                  <label htmlFor="email" className="label">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                    autoComplete="email"
                    inputMode="email"
                    required
                  />
                </div>
                )}
                {mode === 'signup' && (
                  <div>
                    <label htmlFor="phone" className="label">
                      Mobile <span className="font-normal text-ink-400">(optional, for booking updates)</span>
                    </label>
                    <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 13))} className="input" autoComplete="tel" inputMode="tel" />
                  </div>
                )}
                {(mode === 'password' || mode === 'signup') && (
                  <div>
                    <label htmlFor="password" className="label">Password</label>
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="input pr-12"
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        minLength={mode === 'signup' ? 8 : 1}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-ink-400 hover:text-ink-700"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                      </button>
                    </div>
                    {mode === 'signup' && <p className="mt-1.5 text-xs text-ink-400">At least 8 characters, with a letter and a number.</p>}
                  </div>
                )}
              </>
            )}

            {error && (
              <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="press flex h-[52px] w-full items-center justify-center rounded-2xl bg-brand-600 font-bold text-white shadow-glow transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? (
                <Spinner className="border-white/40 border-t-white" />
              ) : stage === 'verify' ? (
                mode === 'signup' ? 'Verify & create account' : 'Verify & sign in'
              ) : mode === 'password' ? (
                'Sign in'
              ) : mode === 'code' ? (
                'Email me a code'
              ) : mode === 'phone' ? (
                'Text me a code'
              ) : (
                'Create account'
              )}
            </button>

            {stage === 'verify' && (
              <button type="button" onClick={() => setStage('form')} className="w-full text-center text-sm font-semibold text-ink-500">
                {mode === 'phone' ? 'Use a different number' : 'Use a different email'}
              </button>
            )}
          </form>

          <p className="mt-8 text-center text-xs leading-relaxed text-ink-400">
            By continuing you agree to Tixit’s{' '}
            <a href={`${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/terms`} className="underline">Terms</a> and{' '}
            <a href={`${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/privacy`} className="underline">Privacy Policy</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
