import Link from 'next/link';
import type { Metadata } from 'next';
import { Rss } from 'lucide-react';
import { fetchPublic, fetchPublicPaged } from '@/lib/api';
import type { BlogCategory, BlogPostCard } from '@/lib/types';
import { CategoryNav } from '@/components/blog/category-nav';
import { PostCard } from '@/components/blog/post-card';
import { PostGrid } from '@/components/blog/post-grid';
import { Pagination } from '@/components/blog/pagination';

/**
 * Articles change on an editorial cadence, not a live one, so a ten-minute
 * revalidation is generous. Pages are still statically served between rebuilds,
 * which is what keeps the Core Web Vitals that feed into ranking healthy.
 */
export const revalidate = 600;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Tixit';
const PER_PAGE = 12;

const DESCRIPTION =
  'Guides to going out and to putting on a show — what is on in your city, how to price and promote an event, and how to book tickets without getting caught out.';

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { page } = await searchParams;
  const pageNumber = Math.max(1, Number(page) || 1);

  return {
    title: pageNumber > 1 ? `Blog — Page ${pageNumber}` : `Blog — Event Guides & Ticketing Advice`,
    description: DESCRIPTION,
    // Every paginated page canonicalises to itself, not to page 1: pointing
    // them all at page 1 tells Google the articles listed on page 2 are
    // duplicates of page 1 and is a reliable way to get them dropped.
    alternates: {
      canonical: pageNumber > 1 ? `/blog?page=${pageNumber}` : '/blog',
      types: { 'application/rss+xml': `${SITE_URL}/blog/rss.xml` },
    },
    openGraph: {
      type: 'website',
      title: `${SITE_NAME} Blog — Event Guides & Ticketing Advice`,
      description: DESCRIPTION,
      url: pageNumber > 1 ? `/blog?page=${pageNumber}` : '/blog',
    },
  };
}

export default async function BlogIndexPage({ searchParams }: PageProps) {
  const { page } = await searchParams;
  const pageNumber = Math.max(1, Number(page) || 1);

  const [result, categories] = await Promise.all([
    fetchPublicPaged<BlogPostCard[]>('/blog', { page: pageNumber, limit: PER_PAGE }, 600),
    fetchPublic<BlogCategory[]>('/blog/categories', undefined, 600),
  ]);

  const posts = result?.data ?? [];
  const meta = result?.meta;

  // The lead article gets the wide treatment, but only on page one — on page
  // three it is simply the fourth-newest post and deserves no special billing.
  const lead = pageNumber === 1 ? posts[0] : undefined;
  const rest = lead ? posts.slice(1) : posts;

  const blogJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${SITE_URL}/blog`,
    name: `${SITE_NAME} Blog`,
    description: DESCRIPTION,
    url: `${SITE_URL}/blog`,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    blogPost: posts.map((post) => ({
      '@type': 'BlogPosting',
      headline: post.title,
      url: `${SITE_URL}/blog/${post.slug}`,
      datePublished: post.publishedAt ?? undefined,
      image: post.coverImageUrl ?? undefined,
      author: { '@type': 'Organization', name: post.authorName },
    })),
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(blogJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <div className="border-b border-ink-200 bg-white">
        <div className="container-page py-10 lg:py-14">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{SITE_NAME} Blog</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
            Going out, and putting on a show
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-600">{DESCRIPTION}</p>

          <div className="mt-6">
            <CategoryNav categories={categories ?? []} />
          </div>
        </div>
      </div>

      <div className="container-page py-10 lg:py-12">
        {lead && (
          <div className="mb-10">
            <PostCard post={lead} featured priority />
          </div>
        )}

        <PostGrid posts={rest} />

        <Pagination basePath="/blog" page={pageNumber} totalPages={meta?.totalPages ?? 1} />

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-ink-200 bg-white p-6 shadow-card">
          <div>
            <h2 className="text-lg font-bold text-ink-900">Running an event?</h2>
            <p className="mt-1 text-sm text-ink-600">
              List it in minutes, take UPI and card payments, and check people in with a QR scan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/blog/rss.xml"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition hover:text-ink-800"
            >
              <Rss className="h-4 w-4" aria-hidden />
              RSS
            </Link>
            <Link
              href="/list-your-show"
              className="inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              List your show
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
