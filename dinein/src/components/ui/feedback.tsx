import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/format';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xl', className)} aria-hidden />;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center', className)}>
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-bold text-ink-900">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
