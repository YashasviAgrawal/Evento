import Image from 'next/image';
import Link from 'next/link';
import { CalendarDays, Clock } from 'lucide-react';
import type { BlogPostCard as BlogPostCardType } from '@/lib/types';
import { formatEventDate } from '@/lib/format';
import { cn } from '@/lib/format';

interface PostCardProps {
  post: BlogPostCardType;
  /** Wide two-column treatment for the lead article on the index page. */
  featured?: boolean;
  className?: string;
  /** The first card above the fold should not be lazy-loaded — it is the LCP element. */
  priority?: boolean;
}

export function PostCard({ post, featured = false, className, priority = false }: PostCardProps) {
  const href = `/blog/${post.slug}`;
  const alt = post.coverImageAlt ?? post.title;

  return (
    <article
      className={cn(
        'group relative flex overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card transition hover:border-ink-300 hover:shadow-lg',
        featured ? 'flex-col md:flex-row' : 'flex-col',
        className,
      )}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden bg-ink-100',
          featured ? 'h-56 md:h-auto md:w-1/2' : 'h-44',
        )}
      >
        {post.coverImageUrl && (
          <Image
            src={post.coverImageUrl}
            alt={alt}
            fill
            priority={priority}
            sizes={featured ? '(max-width: 768px) 100vw, 50vw' : '(max-width: 640px) 100vw, 33vw'}
            className="object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        )}
        {post.category && (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink-800 shadow-sm">
            {post.category.name}
          </span>
        )}
      </div>

      <div className={cn('flex min-w-0 flex-1 flex-col p-5', featured && 'md:justify-center md:p-7')}>
        <h3
          className={cn(
            'font-bold tracking-tight text-ink-900 transition group-hover:text-brand-700',
            featured ? 'text-xl sm:text-2xl' : 'text-base',
          )}
        >
          {/* Stretched link: the whole card is the target, but only the title
              is announced as the link. */}
          <Link href={href} className="before:absolute before:inset-0 before:content-['']">
            {post.title}
          </Link>
        </h3>

        <p
          className={cn(
            'mt-2 text-sm leading-relaxed text-ink-600',
            featured ? 'line-clamp-3' : 'line-clamp-2',
          )}
        >
          {post.excerpt}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
          {post.publishedAt && (
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              <time dateTime={post.publishedAt}>{formatEventDate(post.publishedAt)}</time>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {post.readingMinutes} min read
          </span>
        </div>
      </div>
    </article>
  );
}
