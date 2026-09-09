import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/format';

/**
 * Numbered pagination.
 *
 * Real <a> links rather than buttons, so a crawler can reach page 2 and every
 * article on it. An infinite-scroll or JavaScript-only pager would leave
 * everything past the first page effectively unindexed.
 */
export function Pagination({
  basePath,
  page,
  totalPages,
}: {
  basePath: string;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const href = (target: number) => (target === 1 ? basePath : `${basePath}?page=${target}`);

  // A window around the current page, always including the first and last.
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (value) => value === 1 || value === totalPages || Math.abs(value - page) <= 1,
  );

  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-1.5">
      {page > 1 && (
        <Link href={href(page - 1)} rel="prev" className={linkClass()} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
      )}

      {pages.map((value, index) => (
        <span key={value} className="flex items-center gap-1.5">
          {index > 0 && value - pages[index - 1]! > 1 && <span className="px-1 text-ink-400">…</span>}
          <Link
            href={href(value)}
            aria-current={value === page ? 'page' : undefined}
            className={linkClass(value === page)}
          >
            {value}
          </Link>
        </span>
      ))}

      {page < totalPages && (
        <Link href={href(page + 1)} rel="next" className={linkClass()} aria-label="Next page">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </nav>
  );
}

function linkClass(active = false): string {
  return cn(
    'grid h-9 min-w-9 place-items-center rounded-lg px-3 text-sm font-medium transition',
    active
      ? 'bg-ink-900 text-white'
      : 'border border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50',
  );
}
