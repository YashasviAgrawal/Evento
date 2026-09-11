'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, MailCheck, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { safeNext } from '@/lib/auth-redirect';
import { useAuth, type VerifyPurpose } from '@/components/providers/auth-provider';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Spinner } from '@/components/ui/index';

/**
 * A courtesy throttle so an impatient tap does not burn a send. The real
 * budget is the server's otpLimiter (5 per 10 minutes per address), which
 * still applies and surfaces as an error here if exceeded.
 */
const RESEND_COOLDOWN_SECONDS = 45;

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[70vh] place-items-center"><Spinner className="h-8 w-8" /></div>}>
      <VerifyEmailForm />
    </Suspense>
  );
}

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: sessionLoading, verifyEmail } = useAuth();
  const toast = useToast();

  const next = searchParams.get('next') ?? '';
  const emailParam = searchParams.get('email') ?? '';

  /**
   * `signup` is the mandatory path: the account does not exist until the code
   * is entered, so there is nothing to skip to. `verify_email` is the softer
   * path for accounts that predate this rule (seeded or admin-created), where
   * skipping is still reasonable.
   */
  const purpose: VerifyPurpose = searchParams.get('flow') === 'verify_email' ? 'verify_email' : 'signup';
  const mandatory = purpose === 'signup';

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [verified, setVerified] = useState(false);

  // The address comes from the query string when we arrive straight from
  // registration, and from the session otherwise. Never overwrite what the
  // person has typed.
  const emailTouched = useRef(Boolean(emailParam));
  useEffect(() => {
    if (!emailTouched.current && user?.email) setEmail(user.email);
  }, [user?.email]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function destination(role = user?.role): string {
    const wanted = safeNext(next, role);
    if (wanted) return wanted;
    if (role === 'admin') return '/admin';
    // A brand-new organizer goes straight to KYC: nothing can be paid out until
    // those details are verified, so it is the first thing worth doing. An
    // existing account confirming its address keeps landing on the dashboard.
    if (role === 'organizer') return mandatory ? '/organizer/kyc' : '/organizer';
    return '/events';
  }

  async function resend() {
    setResending(true);
    setError(null);
    try {
      const { data } = await api.post<{ sent: boolean; devOtp?: string }>('/auth/otp/request', {
        email: email.trim(),
        purpose,
      });
      // In development the API echoes the code so the flow is testable without
      // a mail provider configured.
      if (data.devOtp) setDevOtp(data.devOtp);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      toast.toast({ tone: 'info', title: 'Code sent', description: `Check ${email.trim()} for a 6-digit code.` });
    } catch (err) {
      if (err instanceof ApiError) {
        // Nothing is being held for this address, so no code can be resent —
        // the same dead end `submit` handles, reached from the other button.
        if (err.code === 'REGISTRATION_NOT_FOUND') setExpired(true);
        // Already a full account: verifying it again is not the way in.
        if (err.code === 'EMAIL_TAKEN') {
          router.push(`/auth/login?${new URLSearchParams({ ...(next ? { next } : {}) }).toString()}`);
          return;
        }
      }
      setError(err instanceof ApiError ? err.message : 'Could not send a new code');
    } finally {
      setResending(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Verifying returns a session — for a signup that is the account this
      // very request created — so route on the role it reports.
      const verifiedUser = await verifyEmail(email.trim(), code.trim(), purpose);
      setVerified(true);
      toast.success(
        mandatory ? 'Account created' : 'Email verified',
        mandatory ? `Welcome to Tixit, ${verifiedUser.fullName.split(' ')[0]}.` : 'Your address is confirmed.',
      );
      router.push(destination(verifiedUser.role));
      router.refresh();
    } catch (err) {
      // The held registration is gone (expired, or already completed), so a
      // fresh code cannot help — only registering again can.
      if (err instanceof ApiError && err.code === 'REGISTRATION_NOT_FOUND') setExpired(true);
      setError(err instanceof ApiError ? err.message : 'Could not verify that code');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  // Someone who already verified — and lands here from an old link or the
  // browser's back button — should be told, not asked for a dead code. Scoped
  // to the address in the form, so a verified user can still confirm a
  // different account's email from this screen.
  const alreadyVerified =
    !verified &&
    !sessionLoading &&
    Boolean(user?.emailVerified) &&
    user?.email.toLowerCase() === email.trim().toLowerCase();

  const settled = verified || alreadyVerified;

  return (
    <div className="container-page grid min-h-[calc(100vh-4rem)] place-items-center py-10">
      <div className="w-full max-w-md">
        <Link
          href={mandatory ? '/auth/register' : user ? '/account/profile' : '/auth/login'}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
        >
          <ArrowLeft className="h-4 w-4" />
          {mandatory ? 'Back to sign up' : user ? 'Back to your profile' : 'Back to sign in'}
        </Link>

        <div className="rounded-2xl border border-ink-200 bg-white p-7 shadow-card">
          <div className="mb-6 text-center">
            <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white">
              {settled ? <CheckCircle2 className="h-5 w-5" /> : <MailCheck className="h-5 w-5" />}
            </span>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">
              {settled ? 'Email verified' : 'Verify your email'}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {settled ? (
                'Your address is confirmed — you’re all set.'
              ) : email ? (
                <>
                  Enter the 6-digit code we sent to <span className="font-medium text-ink-700">{email}</span>.
                </>
              ) : (
                'Enter your email and the 6-digit code we sent you.'
              )}
            </p>
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

          {expired ? (
            <div className="space-y-4">
              <Alert tone="warning" title="This signup has expired">
                For your security we only hold an unverified signup for a limited time. Registering again takes a
                moment.
              </Alert>
              <Button size="lg" className="w-full" onClick={() => router.push('/auth/register')}>
                Register again
              </Button>
            </div>
          ) : alreadyVerified ? (
            <div className="space-y-4">
              <Alert tone="success">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  {user?.email} is already verified.
                </span>
              </Alert>
              <Button size="lg" className="w-full" onClick={() => router.push(destination())}>
                Continue
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {mandatory && (
                <Alert tone="info">
                  Your account is created once you enter this code — we don’t keep unverified accounts.
                </Alert>
              )}

              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    emailTouched.current = true;
                    setEmail(e.target.value);
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </Field>

              <Field label="Verification code" hint="From the email we just sent you" required>
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

              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={loading}
                disabled={code.length < 4 || !email.trim()}
              >
                {mandatory ? 'Verify & create account' : 'Verify email'}
              </Button>

              <div className="flex flex-col gap-2 text-center text-sm">
                <button
                  type="button"
                  onClick={() => void resend()}
                  disabled={resending || cooldown > 0 || !email.trim()}
                  className="text-ink-500 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-400 disabled:hover:text-ink-400"
                >
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : resending ? 'Sending…' : 'Didn’t get it? Resend code'}
                </button>

                {/* No "skip" on the signup path — there is no account to skip into. */}
                {!mandatory && (
                  <Link href={destination()} className="text-ink-500 hover:text-ink-800">
                    Skip for now
                  </Link>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
