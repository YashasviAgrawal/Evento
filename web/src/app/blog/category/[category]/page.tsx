import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchPublic, fetchPublicPaged } from '@/lib/api';
import type { BlogCategory, BlogPostCard } from '@/lib/types';
import { CategoryNav } from '@/components/blog/category-nav';
import { PostGrid } from '@/components/blog/post-grid';
import { Pagination } from '@/components/blog/pagination';

export const revalidate = 600;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Tixit';
const PER_PAGE = 12;

interface PageProps {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateStaticParams() {
  const categories = await fetchPublic<BlogCategory[]>('/blog/categories', undefined, 600);
  // Only categories that have something in them. An empty category page is a
  // thin page, and pre-rendering one just invites it into the index.
  return (categories ?? [])
    .filter((category) => category.postCount > 0)
    .map((category) => ({ category: category.slug }));
}

async function findCategory(slug: string): Promise<BlogCategory | null> {
  const categories = await fetchPublic<BlogCategory[]>('/blog/categories', undefined, 600);
  return (categories ?? []).find((category) => category.slug === slug) ?? null;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ category: slug }, { page }] = await Promise.all([params, searchParams]);
  const category = await findCategory(slug);
  // See the note in blog/[slug] on why this is noindex rather than a 404 status.
  if (!category) return { title: 'Category not found', robots: { index: false, follow: false } };

  const pageNumber = Math.max(1, Number(page) || 1);
  const base = `/blog/category/${category.slug}`;
  const description =
    category.description ?? `Articles on ${category.name.toLowerCase()} from the ${SITE_NAME} blog.`;

  return {
    title: pageNumber > 1 ? `${category.name} — Page ${pageNumber}` : category.name,
    description,
    // A category with nothing in it is a thin page. It is already kept out of
    // the sitemap and the category nav, so keep it out of the index too rather
    // than letting a crawler find it some other way.
    robots: category.postCount === 0 ? { index: false, follow: true } : undefined,
    alternates: { canonical: pageNumber > 1 ? `${base}?page=${pageNumber}` : base },
    openGraph: {
      type: 'website',
      title: `${category.name} — ${SITE_NAME} Blog`,
      description,
      url: base,
    },
  };
}

export default async function BlogCategoryPage({ params, searchParams }: PageProps) {
  const [{ category: slug }, { page }] = await Promise.all([params, searchParams]);
  const pageNumber = Math.max(1, Number(page) || 1);

  const [category, result, categories] = await Promise.all([
    findCategory(slug),
    fetchPublicPaged<BlogPostCard[]>('/blog', { category: slug, page: pageNumber, limit: PER_PAGE }, 600),
    fetchPublic<BlogCategory[]>('/blog/categories', undefined, 600),
  ]);

  if (!category) notFound();

  const posts = result?.data ?? [];
  const description =
    category.description ?? `Articles on ${category.name.toLowerCase()} from the ${SITE_NAME} blog.`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
      {
        '@type': 'ListItem',
        position: 3,
        name: category.name,
        item: `${SITE_URL}/blog/category/${category.slug}`,
      },
    ],
  };

  const listJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${category.name} — ${SITE_NAME} Blog`,
    description,
    url: `${SITE_URL}/blog/category/${category.slug}`,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: posts.map((post, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: post.title,
        url: `${SITE_URL}/blog/${post.slug}`,
      })),
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listJsonLd) }} />

      <div className="border-b border-ink-200 bg-white">
        <div className="container-page py-10 lg:py-14">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-500">
            <Link href="/" className="hover:text-ink-800">
              Home
            </Link>
            <span className="mx-1.5">/</span>
            <Link href="/blog" className="hover:text-ink-800">
              Blog
            </Link>
          </nav>

          <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">{category.name}</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-600">{description}</p>

          <div className="mt-6">
            <CategoryNav categories={categories ?? []} activeSlug={category.slug} />
          </div>
        </div>
      </div>

      <div className="container-page py-10 lg:py-12">
        <PostGrid posts={posts} />
        <Pagination
          basePath={`/blog/category/${category.slug}`}
          page={pageNumber}
          totalPages={result?.meta?.totalPages ?? 1}
        />
      </div>
    </>
  );
}
