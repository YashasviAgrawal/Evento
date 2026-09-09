import { z } from 'zod';

/** [{ question, answer }] — rendered as schema.org/FAQPage on the article page. */
export const faqItemSchema = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(3).max(2000),
});

export const blogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  category: z.string().trim().max(80).optional(),
  tag: z.string().trim().max(60).optional(),
  q: z.string().trim().max(120).optional(),
  featured: z.enum(['true', 'false']).optional(),
});

export const blogSlugParam = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Invalid slug'),
});

export const blogIdParam = z.object({ id: z.string().uuid() });

export const adminBlogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  category: z.string().trim().max(80).optional(),
  q: z.string().trim().max(120).optional(),
});

/**
 * Every SEO field is optional: a post is publishable with a title, a body and
 * an excerpt, and each override falls back to its on-page counterpart when it
 * is left empty. Requiring them would only produce copy-pasted values.
 */
export const createBlogPostSchema = z.object({
  title: z.string().trim().min(3).max(200),
  // Derived from the title when omitted, so the common case is one less field.
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, numbers and hyphens only')
    .optional(),
  excerpt: z.string().trim().max(500).default(''),
  content: z.string().max(200_000).default(''),
  categoryId: z.string().uuid().nullish(),
  coverImageUrl: z.string().url().max(600).nullish(),
  coverImageAlt: z.string().trim().max(300).nullish(),
  authorName: z.string().trim().min(2).max(120).optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  isFeatured: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  metaTitle: z.string().trim().max(200).nullish(),
  metaDescription: z.string().trim().max(400).nullish(),
  canonicalUrl: z.string().url().max(600).nullish(),
  ogImageUrl: z.string().url().max(600).nullish(),
  focusKeyword: z.string().trim().max(120).nullish(),
  faq: z.array(faqItemSchema).max(20).default([]),
  /** Lets an editor backdate or schedule; defaults to now on first publish. */
  publishedAt: z.string().datetime().nullish(),
});

export const updateBlogPostSchema = createBlogPostSchema.partial();

export type CreateBlogPostInput = z.infer<typeof createBlogPostSchema>;
export type UpdateBlogPostInput = z.infer<typeof updateBlogPostSchema>;
