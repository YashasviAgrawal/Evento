import Link from 'next/link';
import { CalendarSearch, Home, Ticket } from 'lucide-react';

/**
 * Shown for unknown URLs and for `notFound()` — most often an event whose slug
 * changed or that was unpublished. Rather than a dead end, it points at the
 * things the visitor most likely wanted.
 */
export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60vh] items-center justify-center py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <Ticket className="h-7 w-7" aria-hidden />
        </span>

        <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-brand-600">404</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-ink-900">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          The event may have finished, been unpublished, or the link might be mistyped.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href="/events"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            <CalendarSearch className="h-4 w-4" />
            Browse events
          </Link>
          <Link
            href="/"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 transition hover:bg-ink-50"
          >
            <Home className="h-4 w-4" />
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
