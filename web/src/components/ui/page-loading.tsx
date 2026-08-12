import { Skeleton } from '@/components/ui/index';

/**
 * Route-level loading placeholders.
 *
 * These mirror the real page's layout rather than showing a generic spinner,
 * so the content settles into place instead of the whole screen jumping when
 * data lands.
 */

export function DetailPageLoading() {
  return (
    <>
      <Skeleton className="h-64 w-full rounded-none sm:h-80 lg:h-[26rem]" />
      <div className="container-page py-8 lg:py-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-6 w-48 rounded" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-11/12 rounded" />
              <Skeleton className="h-4 w-4/5 rounded" />
            </div>
            <Skeleton className="h-80 w-full rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        </div>
      </div>
    </>
  );
}

export function DashboardLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-56 rounded" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

export function ListPageLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="container-page py-8 lg:py-10">
      <Skeleton className="h-8 w-56 rounded" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function FormPageLoading() {
  return (
    <div className="container-page py-8 lg:py-10">
      <div className="grid gap-7 lg:grid-cols-[1fr_400px]">
        <div className="space-y-5">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
