'use client';

import Link from 'next/link';
import { AlertTriangle, Home, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The screen a user sees when something genuinely failed.
 *
 * Two rules: never show them a stack trace, and always give them a way out.
 * The technical detail is kept behind a disclosure so a developer or a support
 * agent can still read it without it being the first thing a customer meets.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'This one is on us. Try again in a moment — if it keeps happening, get in touch and we will sort it out.',
  error,
  onRetry,
  showHome = true,
}: {
  title?: string;
  description?: string;
  error?: Error & { digest?: string };
  onRetry?: () => void;
  showHome?: boolean;
}) {
  return (
    <div className="container-page flex min-h-[60vh] items-center justify-center py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertTriangle className="h-7 w-7" aria-hidden />
        </span>

        <h1 className="mt-5 text-xl font-bold tracking-tight text-ink-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">{description}</p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {onRetry && (
            <Button onClick={onRetry}>
              <RotateCw className="h-4 w-4" />
              Try again
            </Button>
          )}
          {showHome && (
            <Link
              href="/"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 transition hover:bg-ink-50"
            >
              <Home className="h-4 w-4" />
              Go home
            </Link>
          )}
        </div>

        {error?.digest && (
          <p className="mt-6 text-xs text-ink-400">
            Reference code <span className="font-mono text-ink-500">{error.digest}</span>
          </p>
        )}

        {process.env.NODE_ENV !== 'production' && error?.message && (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-xs font-medium text-ink-500 hover:text-ink-800">
              Technical details (development only)
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-ink-950 p-3 text-left text-[11px] leading-relaxed text-ink-200">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
