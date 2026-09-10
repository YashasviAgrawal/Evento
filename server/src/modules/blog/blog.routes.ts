import { Router } from 'express';
import { authenticate, currentUser, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, buildPageMeta, clientIp, ok, paginated } from '../../utils/http';
import { audit } from '../../services/audit.service';
import * as service from './blog.service';
import {
  adminBlogListQuerySchema,
  blogIdParam,
  blogListQuerySchema,
  blogSlugParam,
  createBlogPostSchema,
  updateBlogPostSchema,
} from './blog.schema';
import type { Infer } from '../../middleware/validate';

/* ─────────────── public — mounted at /api/v1/blog ─────────────── */

export const publicBlogRoutes = Router();

publicBlogRoutes.get(
  '/',
  validate({ query: blogListQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Infer<typeof blogListQuerySchema>;
    const { posts, total } = await service.listPublishedPosts({
      page: q.page,
      limit: q.limit,
      category: q.category,
      tag: q.tag,
      q: q.q,
      featured: q.featured === 'true',
    });

    // Articles change far less often than event inventory, so they can sit in a
    // CDN for minutes rather than seconds.
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    return paginated(res, posts, buildPageMeta(q.page, q.limit, total));
  }),
);

publicBlogRoutes.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await service.listCategories();
    res.setHeader('Cache-Control', 'public, max-age=300');
    return ok(res, categories);
  }),
);

/** Flat list for the RSS feed and the sitemap — no pagination to walk. */
publicBlogRoutes.get(
  '/feed',
  asyncHandler(async (_req, res) => {
    const posts = await service.listAllPublishedForFeed();
    res.setHeader('Cache-Control', 'public, max-age=600');
    return ok(res, posts);
  }),
);

// Registered last so it cannot shadow the literal routes above.
publicBlogRoutes.get(
  '/:slug',
  validate({ params: blogSlugParam }),
  asyncHandler(async (req, res) => {
    const post = await service.getPublishedPostBySlug(req.params.slug!);
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    return ok(res, post);
  }),
);

/* ──────────── admin — mounted at /api/v1/admin/blog ──────────── */

export const adminBlogRoutes = Router();

adminBlogRoutes.use(authenticate, requireAdmin);

adminBlogRoutes.get(
  '/categories',
  asyncHandler(async (_req, res) => ok(res, await service.listCategories())),
);

adminBlogRoutes.get(
  '/',
  validate({ query: adminBlogListQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Infer<typeof adminBlogListQuerySchema>;
    const { posts, total } = await service.listPostsForAdmin(q);
    return paginated(res, posts, buildPageMeta(q.page, q.limit, total));
  }),
);

adminBlogRoutes.post(
  '/',
  validate({ body: createBlogPostSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const post = await service.createPost(req.body, user.id);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'blog.post.created',
      entityType: 'blog_post',
      entityId: post.id,
      metadata: { slug: post.slug, status: post.status },
      ip: clientIp(req),
    });
    return ok(res, post, 201);
  }),
);

adminBlogRoutes.get(
  '/:id',
  validate({ params: blogIdParam }),
  asyncHandler(async (req, res) => ok(res, await service.getPostForAdmin(req.params.id!))),
);

adminBlogRoutes.patch(
  '/:id',
  validate({ params: blogIdParam, body: updateBlogPostSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const post = await service.updatePost(req.params.id!, req.body);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'blog.post.updated',
      entityType: 'blog_post',
      entityId: post.id,
      metadata: { slug: post.slug, status: post.status, fields: Object.keys(req.body ?? {}) },
      ip: clientIp(req),
    });
    return ok(res, post);
  }),
);

adminBlogRoutes.delete(
  '/:id',
  validate({ params: blogIdParam }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await service.deletePost(req.params.id!);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'blog.post.deleted',
      entityType: 'blog_post',
      entityId: req.params.id!,
      ip: clientIp(req),
    });
    return res.status(204).send();
  }),
);
