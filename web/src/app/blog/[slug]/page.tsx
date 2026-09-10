import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CalendarDays, Clock, Tag } from 'lucide-react';
import { fetchPublic } from '@/lib/api';
import type { BlogPostCard, BlogPostDetail } from '@/lib/types';
import { renderArticle, plainSummary } from '@/lib/markdown';
import { formatEventDate } from '@/lib/format';
import { ShareButton } from '@/components/events/share-button';
import { PostCard } from '@/components/blog/post-card';
import { TableOfContents } from '@/components/blog/table-of-contents';
import { FaqSection } from '@/components/blog/faq-section';

export const revalidate = 600;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Tixit';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Pre-render every published article at build time. Articles are the pages
 * most likely to be a crawler's first contact with the site, and a static
 * response is both faster and immune to the API being briefly unreachable.
 * Posts published later are still rendered on demand and then cached.
 */
export async function generateStaticParams() {
  const posts = await fetchPublic<BlogPostCard[]>('/blog/feed', undefined, 600);
  return (posts ?? []).map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await fetchPublic<BlogPostDetail>(`/blog/${slug}`, undefined, 600);
  // An unknown slug renders the 404 page (below) but cannot carry a 404 status:
  // the root layout suspends on the Navbar, so the shell — and with it a 200 —
  // has already been flushed by the time the page can call notFound(). The
  // noindex here is what actually keeps the resulting soft 404 out of the
  // index, which is the part that matters for search.
  if (!post) return { title: 'Article not found', robots: { index: false, follow: false } };

  // The headline a reader sees and the <title> that has to win a click in a
  // result page are different pieces of writing, so meta_title overrides the
  // on-page title when an editor has supplied one.
  const title = post.metaTitle ?? post.title;
  const description = post.metaDescription ?? post.excerpt ?? plainSummary(post.content);
  const image = post.ogImageUrl ?? post.coverImageUrl ?? undefined;
  const canonical = post.canonicalUrl ?? `/blog/${post.slug}`;

  return {
    title,
    description,
    keywords: [post.focusKeyword, ...post.tags, post.category?.name].filter(Boolean) as string[],
    alternates: { canonical },
    authors: [{ name: post.authorName }],
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt,
      authors: [post.authorName],
      tags: post.tags,
      images: image ? [{ url: image, width: 1200, height: 630, alt: post.coverImageAlt ?? post.title }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function BlogArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const post = await fetchPublic<BlogPostDetail>(`/blog/${slug}`, undefined, 600);
  if (!post) notFound();

  const { html, toc } = renderArticle(post.content);
  const url = `${SITE_URL}/blog/${post.slug}`;
  const description = post.metaDescription ?? post.excerpt ?? plainSummary(post.content);
  const image = post.ogImageUrl ?? post.coverImageUrl ?? undefined;

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': url,
    headline: post.title,
    description,
    image: image ? [image] : undefined,
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.updatedAt,
    author: { '@type': 'Organization', name: post.authorName, url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    articleSection: post.category?.name,
    keywords: post.tags.join(', '),
    wordCount: post.content.split(/\s+/).filter(Boolean).length,
    inLanguage: 'en-IN',
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
      ...(post.category
        ? [
            {
              '@type': 'ListItem',
              position: 3,
              name: post.category.name,
              item: `${SITE_URL}/blog/category/${post.category.slug}`,
            },
          ]
        : []),
      { '@type': 'ListItem', position: post.category ? 4 : 3, name: post.title, item: url },
    ],
  };

  // Only emitted when there are questions to describe — markup for content that
  // is not on the page is a manual-action risk, not a ranking trick.
  const faqJsonLd =
    post.faq.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: post.faq.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
          })),
        }
      : null;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      {faqJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      )}

      <div className="container-page py-8 lg:py-10">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-ink-500">
          <Link href="/" className="hover:text-ink-800">
            Home
          </Link>
          <span className="mx-1.5">/</span>
          <Link href="/blog" className="hover:text-ink-800">
            Blog
          </Link>
          {post.category && (
            <>
              <span className="mx-1.5">/</span>
              <Link href={`/blog/category/${post.category.slug}`} className="hover:text-ink-800">
                {post.category.name}
              </Link>
            </>
          )}
        </nav>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <article>
              <header>
                {post.category && (
                  <Link
                    href={`/blog/category/${post.category.slug}`}
                    className="text-xs font-semibold uppercase tracking-wide text-brand-600 hover:text-brand-700"
                  >
                    {post.category.name}
                  </Link>
                )}

                {/* The single H1 on the page. Every other heading in the body
                    is an H2 or lower, which is what a crawler expects. */}
                <h1 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-ink-900 sm:text-4xl">
                  {post.title}
                </h1>

                {post.excerpt && <p className="mt-4 text-lg leading-relaxed text-ink-600">{post.excerpt}</p>}

                <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-ink-200 py-4 text-sm text-ink-500">
                  <span className="font-medium text-ink-700">{post.authorName}</span>
                  {post.publishedAt && (
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4" aria-hidden />
                      <time dateTime={post.publishedAt}>{formatEventDate(post.publishedAt)}</time>
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" aria-hidden />
                    {post.readingMinutes} min read
                  </span>
                  <span className="ml-auto">
                    <ShareButton title={post.title} text={description} />
                  </span>
                </div>
              </header>

              {post.coverImageUrl && (
                <figure className="mt-8">
                  <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-ink-100">
                    <Image
                      src={post.coverImageUrl}
                      alt={post.coverImageAlt ?? post.title}
                      fill
                      priority
                      sizes="(max-width: 1024px) 100vw, 800px"
                      className="object-cover"
                    />
                  </div>
                </figure>
              )}

              {/* Contents inline on narrow screens, where the sidebar is stacked
                  far below the article rather than beside it. */}
              {toc.length >= 3 && (
                <div className="mt-8 lg:hidden">
                  <TableOfContents entries={toc} />
                </div>
              )}

              <div className="article-body mt-8 max-w-[68ch]" dangerouslySetInnerHTML={{ __html: html }} />

              {post.tags.length > 0 && (
                <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-ink-200 pt-6">
                  <Tag className="h-4 w-4 text-ink-400" aria-hidden />
                  {post.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-600">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </article>

            <FaqSection items={post.faq} />

            <section className="mt-14 overflow-hidden rounded-xl bg-ink-950 p-8 text-center">
              <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                Find something to do this week
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-400">
                Concerts, comedy, workshops and more — booked in a single tap, with a QR ticket on your phone.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/events"
                  className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Browse events
                </Link>
                <Link
                  href="/list-your-show"
                  className="rounded-lg border border-ink-700 px-5 py-2.5 text-sm font-semibold text-ink-200 transition hover:border-ink-500 hover:text-white"
                >
                  List your show
                </Link>
              </div>
            </section>
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-5">
              <TableOfContents entries={toc} />
            </div>
          </aside>
        </div>

        {post.related.length > 0 && (
          <section className="mt-16 border-t border-ink-200 pt-10">
            <h2 className="mb-6 text-xl font-bold tracking-tight text-ink-900">Keep reading</h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {post.related.map((item) => (
                <PostCard key={item.id} post={item} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
