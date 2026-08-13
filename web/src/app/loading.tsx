import { EventCardSkeleton } from '@/components/events/event-card';
import { Skeleton } from '@/components/ui/index';

/**
 * Home page placeholder.
 *
 * Deliberately mirrors the real layout — dark hero, category rail, event grid —
 * so the page settles into shape instead of everything appearing at once.
 */
export default function HomeLoading() {
  return (
    <>
      {/* Hero */}
      <section className="bg-ink-950 py-16 sm:py-20 lg:py-24">
        <div className="container-page">
          <div className="mx-auto max-w-3xl space-y-4 text-center">
            <Skeleton className="mx-auto h-7 w-64 rounded-full bg-white/10" />
            <Skeleton className="mx-auto h-12 w-full max-w-2xl rounded-lg bg-white/10" />
            <Skeleton className="mx-auto h-12 w-3/4 rounded-lg bg-white/10" />
            <Skeleton className="mx-auto h-5 w-full max-w-xl rounded bg-white/10" />
          </div>
          <Skeleton className="mx-auto mt-9 h-[4.5rem] w-full max-w-4xl rounded-2xl bg-white/10" />
        </div>
      </section>

      {/* Category rail */}
      <section className="container-page py-12">
        <Skeleton className="h-7 w-52 rounded" />
        <Skeleton className="mt-2 h-4 w-72 rounded" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="aspect-[4/5] rounded-xl sm:aspect-[4/3]" />
          ))}
        </div>
      </section>

      {/* Event rail */}
      <section className="container-page py-12">
        <Skeleton className="h-7 w-44 rounded" />
        <Skeleton className="mt-2 h-4 w-64 rounded" />
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <EventCardSkeleton key={index} />
          ))}
        </div>
      </section>
    </>
  );
}
