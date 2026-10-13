'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, PenLine } from 'lucide-react';
import { useCmsAuth } from '@/components/providers/cms-auth-provider';
import { ApiError } from '@/lib/cms-api';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Spinner } from '@/components/ui/index';

export default function CmsLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-ink-950">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      <CmsLoginForm />
    </Suspense>
  );
}

function CmsLoginForm() {
  const { signIn, user, loading } = useCmsAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Only ever follow a path inside the CMS. An absolute URL in ?next= would
  // turn the login screen into an open redirect.
  const nextParam = searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/cms') ? nextParam : '/cms';

  // Someone who still has a session should not be looking at a login form.
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, router, next]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-ink-950 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-emerald-600">
            <PenLine className="h-6 w-6 text-white" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white">Content Studio</h1>
          <p className="mt-1.5 text-sm text-ink-400">Sign in to manage the blog.</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl bg-white p-6 shadow-lg">
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
              autoFocus
              placeholder="you@example.com"
            />
          </Field>

          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              placeholder="••••••••••"
            />
          </Field>

          <Button type="submit" className="w-full" loading={submitting}>
            <KeyRound className="h-4 w-4" />
            Sign in
          </Button>
        </form>

        {/* No "create an account" link, by design: CMS accounts are issued by an
            existing admin, never self-served. */}
        <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
          Studio accounts are separate from your Tixit account.
          <br />
          Ask an editor with admin access to create one for you.
        </p>
      </div>
    </div>
  );
}
