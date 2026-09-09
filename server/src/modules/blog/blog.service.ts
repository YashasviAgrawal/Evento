import { query, queryOne } from '../../db/pool';
import { logger } from '../../config/logger';
import { NotFoundError, ConflictError } from '../../utils/errors';
import { slugify } from '../../utils/ids';
import { cached, invalidateCache } from '../../utils/cache';
import type { CreateBlogPostInput, UpdateBlogPostInput } from './blog.schema';

/* ─────────────────────────── shapes ─────────────────────────── */

export interface BlogCategorySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  postCount: number;
}

export interface BlogPostCard {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  authorName: string;
  tags: string[];
  isFeatured: boolean;
  readingMinutes: number;
  publishedAt: string | null;
  updatedAt: string;
  category: { id: string; name: string; slug: string } | null;
}

export interface BlogPostDetail extends BlogPostCard {
  content: string;
  status: string;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  focusKeyword: string | null;
  faq: Array<{ question: string; answer: string }>;
  viewCount: number;
  createdAt: string;
  related: BlogPostCard[];
}

/* ─────────────────────────── mapping ─────────────────────────── */

/** Column list shared by every card-shaped query, so the mappers stay in step. */
const CARD_COLUMNS = `
  p.id, p.title, p.slug, p.excerpt, p.cover_image_url, p.cover_image_alt,
  p.author_name, p.tags, p.is_featured, p.reading_minutes, p.published_at, p.updated_at,
  c.id AS category_id, c.name AS category_name, c.slug AS category_slug`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCard(row: any): BlogPostCard {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    coverImageUrl: row.cover_image_url,
    coverImageAlt: row.cover_image_alt,
    authorName: row.author_name,
    tags: row.tags ?? [],
    isFeatured: row.is_featured,
    readingMinutes: row.reading_minutes,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    category: row.category_id
      ? { id: row.category_id, name: row.category_name, slug: row.category_slug }
      : null,
  };
}

/* ───────────────────────── public reads ───────────────────────── */

export async function listCategories(): Promise<BlogCategorySummary[]> {
  const rows = await cached('blog:categories', 300_000, async () => {
    const { rows } = await query(
      `SELECT c.id, c.name, c.slug, c.description,
              (SELECT count(*)::int FROM blog_posts p
                WHERE p.category_id = c.id AND p.status = 'published') AS post_count
         FROM blog_categories c
        ORDER BY c.display_order ASC, c.name ASC`,
    );
    return rows;
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    postCount: row.post_count,
  }));
}

export interface ListPostsOptions {
  page: number;
  limit: number;
  category?: string;
  tag?: string;
  q?: string;
  featured?: boolean;
  /** Exclude a post from its own "related" or "more reading" rail. */
  excludeSlug?: string;
}

export async function listPublishedPosts(
  options: ListPostsOptions,
): Promise<{ posts: BlogPostCard[]; total: number }> {
  const clauses: string[] = [`p.status = 'published'`, `p.published_at <= now()`];
  const params: unknown[] = [];

  if (options.category) {
    params.push(options.category);
    clauses.push(`c.slug = $${params.length}`);
  }
  if (options.tag) {
    params.push(options.tag);
    clauses.push(`$${params.length} = ANY(p.tags)`);
  }
  if (options.q) {
    params.push(options.q);
    clauses.push(
      `(p.search_vector @@ websearch_to_tsquery('english', $${params.length})
        OR p.title ILIKE '%' || $${params.length} || '%')`,
    );
  }
  if (options.featured) clauses.push('p.is_featured = true');
  if (options.excludeSlug) {
    params.push(options.excludeSlug);
    clauses.push(`p.slug <> $${params.length}`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;

  const offset = (options.page - 1) * options.limit;
  params.push(options.limit, offset);

  const [{ rows }, totalRow] = await Promise.all([
    query(
      `SELECT ${CARD_COLUMNS}
         FROM blog_posts p
         LEFT JOIN blog_categories c ON c.id = p.category_id
        ${where}
        ORDER BY p.is_featured DESC, p.published_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    queryOne<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM blog_posts p
         LEFT JOIN blog_categories c ON c.id = p.category_id
        ${where}`,
      params.slice(0, params.length - 2),
    ),
  ]);

  return { posts: rows.map(toCard), total: totalRow?.total ?? 0 };
}

/**
 * Every published post, for the sitemap and the RSS feed. Capped because both
 * consumers care about crawl budget rather than completeness at scale.
 */
export async function listAllPublishedForFeed(limit = 500): Promise<BlogPostCard[]> {
  const { rows } = await query(
    `SELECT ${CARD_COLUMNS}
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id = p.category_id
      WHERE p.status = 'published' AND p.published_at <= now()
      ORDER BY p.published_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(toCard);
}

export async function getPublishedPostBySlug(slug: string): Promise<BlogPostDetail> {
  const post = await queryOne(
    `SELECT ${CARD_COLUMNS}, p.content, p.status, p.meta_title, p.meta_description,
            p.canonical_url, p.og_image_url, p.focus_keyword, p.faq, p.view_count, p.created_at
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id = p.category_id
      WHERE p.slug = $1 AND p.status = 'published' AND p.published_at <= now()`,
    [slug],
  );
  if (!post) throw new NotFoundError('Article');

  // Same category first; topping up with the newest posts overall means a
  // category with a single article still shows a full rail instead of nothing.
  const { rows: relatedRows } = await query(
    `SELECT ${CARD_COLUMNS},
            (p.category_id IS NOT DISTINCT FROM $2) AS same_category
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id = p.category_id
      WHERE p.status = 'published' AND p.published_at <= now() AND p.id <> $1
      ORDER BY same_category DESC, p.published_at DESC
      LIMIT 3`,
    [post.id, post.category_id],
  );

  // Fire-and-forget: a view counter must never fail a page render, and it does
  // not need to be transactional with the read.
  void query('UPDATE blog_posts SET view_count = view_count + 1 WHERE id = $1', [post.id]).catch(
    (err) => logger.warn({ err, slug }, 'Failed to increment blog view count'),
  );

  return {
    ...toCard(post),
    content: post.content,
    status: post.status,
    metaTitle: post.meta_title,
    metaDescription: post.meta_description,
    canonicalUrl: post.canonical_url,
    ogImageUrl: post.og_image_url,
    focusKeyword: post.focus_keyword,
    faq: Array.isArray(post.faq) ? post.faq : [],
    viewCount: post.view_count,
    createdAt: post.created_at,
    related: relatedRows.map(toCard),
  };
}

/* ───────────────────────── admin writes ───────────────────────── */

const ADMIN_COLUMNS = `${CARD_COLUMNS}, p.content, p.status, p.category_id, p.meta_title,
  p.meta_description, p.canonical_url, p.og_image_url, p.focus_keyword, p.faq,
  p.view_count, p.created_at`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAdminPost(row: any) {
  return {
    ...toCard(row),
    content: row.content,
    status: row.status,
    categoryId: row.category_id,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url,
    ogImageUrl: row.og_image_url,
    focusKeyword: row.focus_keyword,
    faq: Array.isArray(row.faq) ? row.faq : [],
    viewCount: row.view_count,
    createdAt: row.created_at,
  };
}

export async function listPostsForAdmin(options: {
  page: number;
  limit: number;
  status?: string;
  category?: string;
  q?: string;
}) {
  const clauses: string[] = ['true'];
  const params: unknown[] = [];

  if (options.status) {
    params.push(options.status);
    clauses.push(`p.status = $${params.length}::blog_post_status`);
  }
  if (options.category) {
    params.push(options.category);
    clauses.push(`c.slug = $${params.length}`);
  }
  if (options.q) {
    params.push(options.q);
    clauses.push(`(p.title ILIKE '%' || $${params.length} || '%' OR p.slug ILIKE '%' || $${params.length} || '%')`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const offset = (options.page - 1) * options.limit;
  params.push(options.limit, offset);

  const [{ rows }, totalRow] = await Promise.all([
    query(
      `SELECT ${ADMIN_COLUMNS}
         FROM blog_posts p
         LEFT JOIN blog_categories c ON c.id = p.category_id
        ${where}
        ORDER BY coalesce(p.published_at, p.created_at) DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    queryOne<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM blog_posts p
         LEFT JOIN blog_categories c ON c.id = p.category_id
        ${where}`,
      params.slice(0, params.length - 2),
    ),
  ]);

  return { posts: rows.map(toAdminPost), total: totalRow?.total ?? 0 };
}

export async function getPostForAdmin(id: string) {
  const row = await queryOne(
    `SELECT ${ADMIN_COLUMNS}
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id = p.category_id
      WHERE p.id = $1`,
    [id],
  );
  if (!row) throw new NotFoundError('Article');
  return toAdminPost(row);
}

/**
 * A slug is a permanent URL, so it is derived once from the title and then only
 * changed deliberately. Collisions are reported rather than silently suffixed:
 * two posts called "Things to do in Jaipur" almost always means the second was
 * meant to be an edit of the first.
 */
async function assertSlugFree(slug: string, exceptId?: string): Promise<void> {
  const clash = await queryOne<{ id: string }>(
    `SELECT id FROM blog_posts WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)`,
    [slug, exceptId ?? null],
  );
  if (clash) throw new ConflictError(`The slug "${slug}" is already used by another article`, 'SLUG_TAKEN');
}

export async function createPost(input: CreateBlogPostInput, authorId: string | null) {
  const slug = input.slug ?? slugify(input.title);
  if (!slug) throw new ConflictError('Could not derive a URL slug from that title', 'SLUG_INVALID');
  await assertSlugFree(slug);

  // Publishing without an explicit date means "now"; the CHECK constraint on
  // the table would otherwise reject the row.
  const publishedAt =
    input.publishedAt ?? (input.status === 'published' ? new Date().toISOString() : null);

  const row = await queryOne<{ id: string }>(
    `INSERT INTO blog_posts (
       title, slug, excerpt, content, category_id, cover_image_url, cover_image_alt,
       author_name, author_id, status, is_featured, tags, meta_title, meta_description,
       canonical_url, og_image_url, focus_keyword, faq, published_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8,'Tixit Editorial'),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)
     RETURNING id`,
    [
      input.title,
      slug,
      input.excerpt,
      input.content,
      input.categoryId ?? null,
      input.coverImageUrl ?? null,
      input.coverImageAlt ?? null,
      input.authorName ?? null,
      authorId,
      input.status,
      input.isFeatured,
      input.tags,
      input.metaTitle ?? null,
      input.metaDescription ?? null,
      input.canonicalUrl ?? null,
      input.ogImageUrl ?? null,
      input.focusKeyword ?? null,
      JSON.stringify(input.faq),
      publishedAt,
    ],
  );

  invalidateCache('blog:');
  return getPostForAdmin(row!.id);
}

/** Input field → column, for the partial update below. */
const UPDATABLE: Record<string, string> = {
  title: 'title',
  slug: 'slug',
  excerpt: 'excerpt',
  content: 'content',
  categoryId: 'category_id',
  coverImageUrl: 'cover_image_url',
  coverImageAlt: 'cover_image_alt',
  authorName: 'author_name',
  status: 'status',
  isFeatured: 'is_featured',
  tags: 'tags',
  metaTitle: 'meta_title',
  metaDescription: 'meta_description',
  canonicalUrl: 'canonical_url',
  ogImageUrl: 'og_image_url',
  focusKeyword: 'focus_keyword',
  publishedAt: 'published_at',
};

export async function updatePost(id: string, input: UpdateBlogPostInput) {
  const existing = await getPostForAdmin(id);
  if (input.slug && input.slug !== existing.slug) await assertSlugFree(input.slug, id);

  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [field, column] of Object.entries(UPDATABLE)) {
    const value = (input as Record<string, unknown>)[field];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (input.faq !== undefined) {
    params.push(JSON.stringify(input.faq));
    sets.push(`faq = $${params.length}::jsonb`);
  }

  // Going live for the first time without an explicit date stamps it now, so
  // the caller never has to remember the CHECK constraint.
  if (input.status === 'published' && input.publishedAt === undefined && !existing.publishedAt) {
    params.push(new Date().toISOString());
    sets.push(`published_at = $${params.length}`);
  }

  if (sets.length === 0) return existing;

  params.push(id);
  await query(`UPDATE blog_posts SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

  invalidateCache('blog:');
  return getPostForAdmin(id);
}

export async function deletePost(id: string): Promise<void> {
  const { rowCount } = await query('DELETE FROM blog_posts WHERE id = $1', [id]);
  if (!rowCount) throw new NotFoundError('Article');
  invalidateCache('blog:');
}
