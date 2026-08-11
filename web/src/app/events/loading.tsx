import { EventCardSkeleton } from '@/components/events/event-card';
import { Skeleton } from '@/components/ui/index';

/** Streamed while the events listing fetches on the server. */
export default function EventsLoading() {
  return (
    <div className="container-page py-8 lg:py-10">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-8 w-64" />

      <div className="mt-7 grid gap-7 lg:grid-cols-[260px_1fr]">
        <Skeleton className="hidden h-96 rounded-xl lg:block" />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <EventCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
