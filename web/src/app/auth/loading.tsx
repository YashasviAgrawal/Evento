import { Skeleton } from '@/components/ui/index';

export default function AuthLoading() {
  return (
    <div className="container-page grid min-h-[calc(100vh-4rem)] place-items-center py-10">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-[26rem] w-full rounded-2xl" />
      </div>
    </div>
  );
}
