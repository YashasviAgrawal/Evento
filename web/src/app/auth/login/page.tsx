'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, KeyRound, Mail, Ticket } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Spinner } from '@/components/ui/index';
import { cn } from '@/lib/format';

type Mode = 'password' | 'otp';

const DEMO_ACCOUNTS = [
  { label: 'Customer', email: 'customer@evento.test' },
  { label: 'Organizer', email: 'organizer@evento.test' },
  { label: 'Admin', email: 'admin@evento.test' },
];

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[70vh] place-items-center"><Spinner className="h-8 w-8" /></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signInWithOtp } = useAuth();
  const toast = useToast();

  const next = searchParams.get('next') ?? '';
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('Password123');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Role decides where you land when no explicit `next` was supplied. */
  function destinationFor(role: string): string {
    if (next) return next;
    if (role === 'admin') return '/admin';
    if (role === 'organizer') return '/organizer';
    return '/account/bookings';
  }

  async function handlePasswordLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await signIn(email.trim(), password);
      toast.success(`Welcome back, ${user.fullName.split(' ')[0]}`);
      router.push(destinationFor(user.role));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign you in');
    } finally {
      setLoading(false);
    }
  }

  async function requestOtp(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<{ sent: boolean; devOtp?: string }>('/auth/otp/request', {
        email: email.trim(),
        purpose: 'login',
      });
      setOtpSent(true);
      // In development the API echoes the code so the flow is testable
      // without a mail provider configured.
      if (data.devOtp) setDevOtp(data.devOtp);
      toast.toast({ tone: 'info', title: 'Code sent', description: `Check ${email} for a 6-digit code.` });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await signInWithOtp(email.trim(), code.trim());
      toast.success(`Welcome back, ${user.fullName.split(' ')[0]}`);
      router.push(destinationFor(user.role));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify the code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-page grid min-h-[calc(100vh-4rem)] place-items-center py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
          <ArrowLeft className="h-4 w-4" />
          Back to Evento
        </Link>

        <div className="rounded-2xl border border-ink-200 bg-white p-7 shadow-card">
          <div className="mb-6 text-center">
            <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white">
              <Ticket className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">Welcome back</h1>
            <p className="mt-1 text-sm text-ink-500">Sign in to book tickets and manage your events</p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-ink-100 p-1">
            {(
              [
                { key: 'password', label: 'Password', Icon: KeyRound },
                { key: 'otp', label: 'Email OTP', Icon: Mail },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => {
                  setMode(key);
                  setError(null);
                  setOtpSent(false);
                }}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition',
                  mode === key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {error && (
            <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}

          {devOtp && (
            <Alert tone="info" className="mb-4" title="Development mode">
              Your code is <span className="font-mono text-base font-bold">{devOtp}</span>
            </Alert>
          )}

          {mode === 'password' ? (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </Field>

              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <label className="text-sm font-medium text-ink-700">
                    Password<span className="ml-0.5 text-brand-600">*</span>
                  </label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>

              <Button type="submit" size="lg" className="w-full" loading={loading}>
                Sign in
              </Button>
            </form>
          ) : !otpSent ? (
            <form onSubmit={requestOtp} className="space-y-4">
              <Field label="Email" hint="We’ll email you a 6-digit code" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={loading}>
                Send code
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-4">
              <Field label="Verification code" hint={`Sent to ${email}`} required>
                <Input
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="text-center font-mono text-xl tracking-[0.5em]"
                  maxLength={6}
                  autoFocus
                  required
                />
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={loading} disabled={code.length < 4}>
                Verify &amp; sign in
              </Button>
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setCode('');
                  setDevOtp(null);
                }}
                className="w-full text-center text-sm text-ink-500 hover:text-ink-800"
              >
                Use a different email
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-ink-500">
            New to Evento?{' '}
            <Link
              href={`/auth/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Create an account
            </Link>
          </p>
        </div>

        {/* Demo credentials — this is a seeded demo environment. */}
        <div className="mt-5 rounded-xl border border-dashed border-ink-300 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Demo accounts</p>
          <div className="mt-2.5 grid gap-1.5">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                onClick={() => {
                  setMode('password');
                  setEmail(account.email);
                  setPassword('Password123');
                }}
                className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-ink-100"
              >
                <span className="font-medium text-ink-700">{account.label}</span>
                <span className="font-mono text-ink-500">{account.email}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 px-2.5 text-xs text-ink-400">
            Password: <span className="font-mono">Password123</span>
          </p>
        </div>
      </div>
    </div>
  );
}
