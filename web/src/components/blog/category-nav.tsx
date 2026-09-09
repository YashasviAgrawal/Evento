import Link from 'next/link';
import type { BlogCategory } from '@/lib/types';
import { cn } from '@/lib/format';

/**
 * Category pills.
 *
 * Rendered as real links rather than client-side filters so each category is a
 * crawlable URL with its own title and description — the category pages are
 * part of what ranks, not just navigation.
 *
 * Empty categories are hidden: a link to a page with no articles is a thin
 * page, which helps nobody.
 */
export function CategoryNav({
  categories,
  activeSlug,
}: {
  categories: BlogCategory[];
  activeSlug?: string;
}) {
  const populated = categories.filter((category) => category.postCount > 0);
  if (populated.length === 0) return null;

  return (
    <nav aria-label="Article categories" className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        <li>
          <Pill href="/blog" active={!activeSlug}>
            All articles
          </Pill>
        </li>
        {populated.map((category) => (
          <li key={category.id}>
            <Pill href={`/blog/category/${category.slug}`} active={activeSlug === category.slug}>
              {category.name}
              <span className={cn('ml-1.5', activeSlug === category.slug ? 'text-white/70' : 'text-ink-400')}>
                {category.postCount}
              </span>
            </Pill>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition',
        active
          ? 'bg-ink-900 text-white'
          : 'border border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50',
      )}
    >
      {children}
    </Link>
  );
}
