'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Building2, Ticket, User } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Spinner } from '@/components/ui/index';
import { GoogleButton } from '@/components/auth/google-button';
import { cn } from '@/lib/format';

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[70vh] place-items-center"><Spinner className="h-8 w-8" /></div>}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { register, signInWithGoogle } = useAuth();
  const toast = useToast();

  const next = searchParams.get('next') ?? '';
  const [role, setRole] = useState<'customer' | 'organizer'>(
    searchParams.get('role') === 'organizer' ? 'organizer' : 'customer',
  );
  const [form, setForm] = useState({
    fullName: '',
    // Prefilled when someone arrives from the "that email is not registered"
    // message on the login page, so they do not retype what they just typed.
    email: searchParams.get('email') ?? '',
    phone: '',
    password: '',
    organizerName: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (form.fullName.trim().length < 2) next.fullName = 'Enter your full name';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) next.email = 'Enter a valid email address';
    if (form.password.length < 8) next.password = 'Use at least 8 characters';
    if (form.phone && !/^(\+?\d{1,3}[- ]?)?\d{10}$/.test(form.phone.trim())) {
      next.phone = 'Enter a valid 10-digit phone number';
    }
    if (role === 'organizer' && form.organizerName.trim().length < 2) {
      next.organizerName = 'Enter your organization or brand name';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setApiError(null);
    try {
      await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
        role,
        organizerName: role === 'organizer' ? form.organizerName.trim() : undefined,
      });

      // No account exists yet — the server is holding these details until the
      // emailed code comes back, and creating it is that step's side effect.
      // So there is nothing to sign in to; go straight to the code screen.
      toast.toast({
        tone: 'info',
        title: 'Check your email',
        description: `We sent a 6-digit code to ${form.email.trim()}.`,
      });

      const fallback = role === 'organizer' ? '/organizer' : '/events';
      const params = new URLSearchParams({ email: form.email.trim(), next: next || fallback });
      router.push(`/auth/verify-email?${params.toString()}`);
    } catch (err) {
      setApiError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not create your account');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Google has already proven the address, so this account skips the emailed
   * code entirely and the person is signed in on the spot. The role chosen
   * above is not carried across: Google signup always creates a customer, and
   * an organizer profile is added later from the dashboard.
   */
  async function handleGoogle(credential: string) {
    setApiError(null);
    try {
      const { user, created } = await signInWithGoogle(credential);
      toast.success(created ? `Welcome to Tixit, ${user.fullName.split(' ')[0]}` : 'Welcome back');
      router.push(next || (user.role === 'organizer' ? '/organizer' : '/events'));
      router.refresh();
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Could not sign you up with Google');
    }
  }

  return (
    <div className="container-page grid min-h-[calc(100vh-4rem)] place-items-center py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
          <ArrowLeft className="h-4 w-4" />
          Back to Tixit
        </Link>

        <div className="rounded-2xl border border-ink-200 bg-white p-7 shadow-card">
          <div className="mb-6 text-center">
            <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white">
              <Ticket className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">Create your account</h1>
            <p className="mt-1 text-sm text-ink-500">Book tickets, or start selling your own</p>
          </div>

          <GoogleButton
            onCredential={handleGoogle}
            text="signup_with"
            dividerLabel="or sign up with email"
            disabled={loading}
          />

          <div className="mb-6 grid grid-cols-2 gap-2">
            {(
              [
                { key: 'customer', label: 'I’m attending', Icon: User },
                { key: 'organizer', label: 'I’m organizing', Icon: Building2 },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setRole(key)}
                aria-pressed={role === key}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition',
                  role === key
                    ? 'border-brand-600 bg-brand-50 text-brand-900'
                    : 'border-ink-200 text-ink-600 hover:border-ink-300 hover:bg-ink-50',
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs font-semibold">{label}</span>
              </button>
            ))}
          </div>

          {apiError && (
            <Alert tone="error" className="mb-4" onDismiss={() => setApiError(null)}>
              {apiError}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Full name" required error={errors.fullName}>
              <Input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="Aarav Sharma"
                autoComplete="name"
                invalid={Boolean(errors.fullName)}
              />
            </Field>

            {role === 'organizer' && (
              <Field
                label="Organization name"
                required
                error={errors.organizerName}
                hint="Shown to customers on your event pages"
              >
                <Input
                  value={form.organizerName}
                  onChange={(e) => setForm({ ...form, organizerName: e.target.value })}
                  placeholder="Nova Live Entertainment"
                  invalid={Boolean(errors.organizerName)}
                />
              </Field>
            )}

            <Field label="Email" required error={errors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
                autoComplete="email"
                invalid={Boolean(errors.email)}
              />
            </Field>

            <Field label="Phone" hint="Optional — for booking updates" error={errors.phone}>
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="9876543210"
                autoComplete="tel"
                invalid={Boolean(errors.phone)}
              />
            </Field>

            <Field label="Password" required error={errors.password} hint="At least 8 characters">
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                autoComplete="new-password"
                invalid={Boolean(errors.password)}
              />
            </Field>

            {role === 'organizer' && (
              <Alert tone="info">
                Organizer accounts are reviewed by our team before you can publish events. You can start creating
                drafts right away.
              </Alert>
            )}

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Continue
            </Button>

            <p className="text-center text-xs text-ink-500">
              We’ll email you a 6-digit code to confirm your address. Your account is created once you enter it.
            </p>
          </form>

          <p className="mt-5 text-center text-xs leading-relaxed text-ink-500">
            By creating an account you agree to our{' '}
            <Link href="/terms" className="underline hover:text-ink-800">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline hover:text-ink-800">
              Privacy Policy
            </Link>
            .
          </p>

          <p className="mt-5 text-center text-sm text-ink-500">
            Already have an account?{' '}
            <Link
              href={`/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
