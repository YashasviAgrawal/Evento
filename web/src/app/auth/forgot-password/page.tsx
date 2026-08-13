'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, KeyRound, MailCheck, Ticket } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Spinner } from '@/components/ui/index';

type Stage = 'request' | 'reset' | 'done';

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[70vh] place-items-center"><Spinner className="h-8 w-8" /></div>}>
      <ForgotPasswordForm />
    </Suspense>
  );
}

function ForgotPasswordForm() {
  const router = useRouter();
  const toast = useToast();
  const { signIn } = useAuth();

  const [stage, setStage] = useState<Stage>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<{ sent: boolean; devOtp?: string }>('/auth/otp/request', {
        email: email.trim(),
        purpose: 'reset_password',
      });
      // The API never reveals whether an address is registered, so the copy
      // below is deliberately conditional ("if that email is registered").
      if (data.devOtp) setDevOtp(data.devOtp);
      setStage('reset');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the reset code');
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();

    if (password.length < 8) {
      setError('Your new password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Verifying with purpose=reset_password sets the new password and
      // revokes every existing session server-side.
      await api.post('/auth/otp/verify', {
        email: email.trim(),
        code: code.trim(),
        purpose: 'reset_password',
        newPassword: password,
      });

      setStage('done');
      toast.success('Password updated', 'Signing you in…');

      // Sign in with the new credentials so they land back in the product
      // rather than at another login form.
      try {
        const user = await signIn(email.trim(), password);
        router.push(user.role === 'admin' ? '/admin' : user.role === 'organizer' ? '/organizer' : '/account/bookings');
        router.refresh();
      } catch {
        router.push('/auth/login');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password');
      setLoading(false);
    }
  }

  return (
    <div className="container-page grid min-h-[calc(100vh-4rem)] place-items-center py-10">
      <div className="w-full max-w-md">
        <Link
          href="/auth/login"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>

        <div className="rounded-2xl border border-ink-200 bg-white p-7 shadow-card">
          <div className="mb-6 text-center">
            <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white">
              {stage === 'done' ? <CheckCircle2 className="h-5 w-5" /> : stage === 'reset' ? <MailCheck className="h-5 w-5" /> : <Ticket className="h-5 w-5" strokeWidth={2.5} />}
            </span>

            <h1 className="text-xl font-bold tracking-tight text-ink-900">
              {stage === 'request' && 'Reset your password'}
              {stage === 'reset' && 'Check your email'}
              {stage === 'done' && 'Password updated'}
            </h1>

            <p className="mt-1 text-sm text-ink-500">
              {stage === 'request' && 'We’ll email you a 6-digit code to set a new password.'}
              {stage === 'reset' && (
                <>
                  If <span className="font-medium text-ink-700">{email}</span> is registered, a code is on its way.
                </>
              )}
              {stage === 'done' && 'Signing you in with your new password…'}
            </p>
          </div>

          {error && (
            <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}

          {devOtp && stage === 'reset' && (
            <Alert tone="info" className="mb-4" title="Development mode">
              Your code is <span className="font-mono text-base font-bold">{devOtp}</span>
            </Alert>
          )}

          {stage === 'request' && (
            <form onSubmit={requestCode} className="space-y-4">
              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </Field>

              <Button type="submit" size="lg" className="w-full" loading={loading}>
                Send reset code
              </Button>
            </form>
          )}

          {stage === 'reset' && (
            <form onSubmit={resetPassword} className="space-y-4">
              <Field label="Verification code" required>
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

              <Field label="New password" required hint="At least 8 characters">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
              </Field>

              <Field label="Confirm new password" required>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
              </Field>

              <Alert tone="info">
                Resetting your password signs you out of every other device.
              </Alert>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={loading}
                disabled={code.length < 4 || !password}
              >
                <KeyRound className="h-4 w-4" />
                Set new password
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStage('request');
                  setCode('');
                  setDevOtp(null);
                  setError(null);
                }}
                className="w-full text-center text-sm text-ink-500 hover:text-ink-800"
              >
                Use a different email
              </button>
            </form>
          )}

          {stage === 'done' && (
            <div className="flex justify-center py-4">
              <Spinner className="h-6 w-6" />
            </div>
          )}

          <p className="mt-6 text-center text-sm text-ink-500">
            Remembered it?{' '}
            <Link href="/auth/login" className="font-semibold text-brand-600 hover:text-brand-700">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
