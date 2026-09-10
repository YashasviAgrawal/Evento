import { fetchPublic } from '@/lib/api';
import type { BlogPostCard } from '@/lib/types';

/**
 * RSS 2.0 feed for the blog.
 *
 * Still worth publishing: aggregators and newsletter tools consume it, and it
 * gives anyone syndicating the articles a canonical source to point back at.
 */
export const revalidate = 3600;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Tixit';

/** XML has no tolerance for a stray ampersand in a title. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(): Promise<Response> {
  const posts = (await fetchPublic<BlogPostCard[]>('/blog/feed', undefined, 3600)) ?? [];

  const items = posts
    .map((post) => {
      const url = `${SITE_URL}/blog/${post.slug}`;
      const pubDate = new Date(post.publishedAt ?? post.updatedAt).toUTCString();
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(post.excerpt)}</description>
      ${post.category ? `<category>${escapeXml(post.category.name)}</category>` : ''}
    </item>`;
    })
    .join('\n');

  const lastBuildDate = new Date(posts[0]?.publishedAt ?? Date.now()).toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)} Blog</title>
    <link>${SITE_URL}/blog</link>
    <description>Event guides, city listings and ticketing advice from ${escapeXml(SITE_NAME)}.</description>
    <language>en-in</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
