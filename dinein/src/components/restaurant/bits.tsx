import { Star, Tag } from 'lucide-react';
import { cn } from '@/lib/format';

export function RatingPill({ rating, count, className }: { rating: number; count?: number; className?: string }) {
  if (!rating) {
    return <span className={cn('rounded-md bg-ink-100 px-1.5 py-0.5 text-[11px] font-bold text-ink-500', className)}>New</span>;
  }
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="inline-flex items-center gap-0.5 rounded-md bg-save-600 px-1.5 py-0.5 text-[11.5px] font-extrabold text-white">
        {rating.toFixed(1)}
        <Star className="h-2.5 w-2.5 fill-white stroke-none" aria-hidden />
      </span>
      {count !== undefined && <span className="text-xs text-ink-500">({count.toLocaleString('en-IN')})</span>}
    </span>
  );
}

/** Savings are always emerald — never brand red — so "money back" reads at a glance. */
export function OfferBadge({ label, tone = 'solid', className }: { label: string; tone?: 'solid' | 'soft'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-extrabold',
        tone === 'solid' ? 'bg-white text-save-700 shadow-card' : 'bg-save-50 text-save-700 ring-1 ring-inset ring-save-100',
        className,
      )}
    >
      <Tag className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

export function OpenDot({ open, closesAt }: { open: boolean; closesAt?: string | null }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', open ? 'text-save-700' : 'text-ink-400')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', open ? 'bg-save-500' : 'bg-ink-300')} aria-hidden />
      {open ? (closesAt ? `Open till ${formatClose(closesAt)}` : 'Open now') : 'Closed now'}
    </span>
  );
}

function formatClose(time: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 && h < 24 ? 'PM' : 'AM'}`;
}
