/**
 * The CMS API, mounted at /api/v1/cms.
 *
 * Two halves: `/auth/*`, which is how a CMS account gets a session, and
 * everything else, which sits behind `authenticateCms`. Content operations
 * delegate to the blog service — the CMS is a second, separately authenticated
 * front door onto the same articles, not a second copy of them.
 */
import { Router } from 'express';
import { cmsAuthLimiter } from '../../middleware/rateLimit';
import { validate, type Infer } from '../../middleware/validate';
import { asyncHandler, buildPageMeta, clientIp, ok, paginated } from '../../utils/http';
import * as blog from '../blog/blog.service';
import {
  adminBlogListQuerySchema,
  blogIdParam,
  createBlogPostSchema,
  updateBlogPostSchema,
} from '../blog/blog.schema';
import { authenticateCms, currentCmsUser, requireCmsAdmin } from './cms.middleware';
import * as service from './cms.service';
import {
  cmsActivityQuerySchema,
  cmsCategorySchema,
  cmsChangePasswordSchema,
  cmsCreateUserSchema,
  cmsIdParam,
  cmsLoginSchema,
  cmsRefreshSchema,
  cmsUpdateCategorySchema,
  cmsUpdateUserSchema,
} from './cms.schema';
import { revokeCmsSession, rotateCmsSession, signCmsAccessToken } from './cms.token.service';

const router = Router();

/* ─────────────────────────── /cms/auth ─────────────────────────── */

const auth = Router();

auth.post(
  '/login',
  cmsAuthLimiter,
  validate({ body: cmsLoginSchema }),
  asyncHandler(async (req, res) => {
    const user = await service.loginCmsUser(req.body);
    const session = await service.createCmsSession(user, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    });

    await service.recordActivity({
      actor: { id: user.id, email: user.email },
      action: 'cms.signed_in',
      entityType: 'cms_user',
      entityId: user.id,
      ip: clientIp(req),
    });

    return ok(res, { user, ...session });
  }),
);

/**
 * Exchange a session token for a fresh access token, rotating the session in
 * the process. The account is re-read here too, so a suspension ends the
 * session at the next refresh rather than lingering for its full lifetime.
 */
auth.post(
  '/refresh',
  validate({ body: cmsRefreshSchema }),
  asyncHandler(async (req, res) => {
    const rotated = await rotateCmsSession(req.body.sessionToken, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    });
    const user = await service.getActiveCmsUser(rotated.cmsUserId);

    return ok(res, {
      user,
      accessToken: signCmsAccessToken({ sub: user.id, email: user.email, role: user.role }),
      sessionToken: rotated.token,
      expiresAt: rotated.expiresAt,
    });
  }),
);

auth.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = (req.body as { sessionToken?: string } | undefined)?.sessionToken;
    if (token) await revokeCmsSession(token);
    return ok(res, { signedOut: true });
  }),
);

auth.get(
  '/me',
  authenticateCms,
  asyncHandler(async (req, res) => ok(res, currentCmsUser(req))),
);

auth.post(
  '/change-password',
  authenticateCms,
  validate({ body: cmsChangePasswordSchema }),
  asyncHandler(async (req, res) => {
    const user = currentCmsUser(req);
    await service.changeCmsPassword(user.id, req.body);
    await service.recordActivity({
      actor: { id: user.id, email: user.email },
      action: 'cms.password_changed',
      entityType: 'cms_user',
      entityId: user.id,
      ip: clientIp(req),
    });
    // Every session was just revoked, including this one — the client has to
    // sign in again, and is told so rather than discovering it on the next call.
    return ok(res, { changed: true, signedOutEverywhere: true });
  }),
);

router.use('/auth', auth);

/* ─────────────────── everything below needs a session ─────────────────── */

router.use(authenticateCms);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => ok(res, await blog.getBlogStats())),
);

router.get(
  '/activity',
  validate({ query: cmsActivityQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Infer<typeof cmsActivityQuerySchema>;
    return ok(res, await service.listActivity(q.limit));
  }),
);

/* ───────────────────────────── posts ───────────────────────────── */

const posts = Router();

posts.get(
  '/',
  validate({ query: adminBlogListQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Infer<typeof adminBlogListQuerySchema>;
    const { posts: rows, total } = await blog.listPostsForAdmin(q);
    return paginated(res, rows, buildPageMeta(q.page, q.limit, total));
  }),
);

posts.post(
  '/',
  validate({ body: createBlogPostSchema }),
  asyncHandler(async (req, res) => {
    const user = currentCmsUser(req);
    // A post written here is attributed to the CMS account, not to a platform
    // user — hence the null in the middle argument.
    const post = await blog.createPost(req.body, null, user.id);

    await service.recordActivity({
      actor: { id: user.id, email: user.email },
      action: post.status === 'published' ? 'post.published' : 'post.created',
      entityType: 'blog_post',
      entityId: post.id,
      summary: post.title,
      metadata: { slug: post.slug, status: post.status },
      ip: clientIp(req),
    });

    return ok(res, post, 201);
  }),
);

posts.get(
  '/:id',
  validate({ params: blogIdParam }),
  asyncHandler(async (req, res) => ok(res, await blog.getPostForAdmin(req.params.id!))),
);

posts.patch(
  '/:id',
  validate({ params: blogIdParam, body: updateBlogPostSchema }),
  asyncHandler(async (req, res) => {
    const user = currentCmsUser(req);
    const before = await blog.getPostForAdmin(req.params.id!);
    const post = await blog.updatePost(req.params.id!, req.body);

    // "Published" is the change worth being able to find later, so it gets its
    // own action rather than being buried in a generic update.
    const wentLive = before.status !== 'published' && post.status === 'published';
    await service.recordActivity({
      actor: { id: user.id, email: user.email },
      action: wentLive ? 'post.published' : 'post.updated',
      entityType: 'blog_post',
      entityId: post.id,
      summary: post.title,
      metadata: { slug: post.slug, status: post.status, fields: Object.keys(req.body ?? {}) },
      ip: clientIp(req),
    });

    return ok(res, post);
  }),
);

posts.delete(
  '/:id',
  validate({ params: blogIdParam }),
  asyncHandler(async (req, res) => {
    const user = currentCmsUser(req);
    // Read it first so the trail can name what was removed; after the delete
    // there is nothing left to look the title up from.
    const post = await blog.getPostForAdmin(req.params.id!);
    await blog.deletePost(post.id);

    await service.recordActivity({
      actor: { id: user.id, email: user.email },
      action: 'post.deleted',
      entityType: 'blog_post',
      entityId: post.id,
      summary: post.title,
      metadata: { slug: post.slug },
      ip: clientIp(req),
    });

    return res.status(204).send();
  }),
);

router.use('/posts', posts);

/* ─────────────────────────── categories ─────────────────────────── */

const categories = Router();

categories.get(
  '/',
  asyncHandler(async (_req, res) => ok(res, await blog.listCategories())),
);

categories.post(
  '/',
  validate({ body: cmsCategorySchema }),
  asyncHandler(async (req, res) => {
    const user = currentCmsUser(req);
    const category = await blog.createCategory(req.body);
    await service.recordActivity({
      actor: { id: user.id, email: user.email },
      action: 'category.created',
      entityType: 'blog_category',
      entityId: category.id,
      summary: category.name,
      ip: clientIp(req),
    });
    return ok(res, category, 201);
  }),
);

categories.patch(
  '/:id',
  validate({ params: cmsIdParam, body: cmsUpdateCategorySchema }),
  asyncHandler(async (req, res) => {
    const user = currentCmsUser(req);
    const category = await blog.updateCategory(req.params.id!, req.body);
    await service.recordActivity({
      actor: { id: user.id, email: user.email },
      action: 'category.updated',
      entityType: 'blog_category',
      entityId: category.id,
      summary: category.name,
      ip: clientIp(req),
    });
    return ok(res, category);
  }),
);

categories.delete(
  '/:id',
  validate({ params: cmsIdParam }),
  asyncHandler(async (req, res) => {
    const user = currentCmsUser(req);
    const category = await blog.getCategory(req.params.id!);
    await blog.deleteCategory(category.id);
    await service.recordActivity({
      actor: { id: user.id, email: user.email },
      action: 'category.deleted',
      entityType: 'blog_category',
      entityId: category.id,
      summary: category.name,
      ip: clientIp(req),
    });
    return res.status(204).send();
  }),
);

router.use('/categories', categories);

/* ──────────────────── accounts (CMS admins only) ──────────────────── */

const users = Router();

users.use(requireCmsAdmin);

users.get(
  '/',
  asyncHandler(async (_req, res) => ok(res, await service.listCmsUsers())),
);

users.post(
  '/',
  validate({ body: cmsCreateUserSchema }),
  asyncHandler(async (req, res) => {
    const actor = currentCmsUser(req);
    const created = await service.createCmsUser(req.body);
    await service.recordActivity({
      actor: { id: actor.id, email: actor.email },
      action: 'cms_user.created',
      entityType: 'cms_user',
      entityId: created.id,
      summary: created.email,
      metadata: { role: created.role },
      ip: clientIp(req),
    });
    return ok(res, created, 201);
  }),
);

users.patch(
  '/:id',
  validate({ params: cmsIdParam, body: cmsUpdateUserSchema }),
  asyncHandler(async (req, res) => {
    const actor = currentCmsUser(req);
    const updated = await service.updateCmsUser(req.params.id!, req.body, actor.id);
    await service.recordActivity({
      actor: { id: actor.id, email: actor.email },
      action: 'cms_user.updated',
      entityType: 'cms_user',
      entityId: updated.id,
      summary: updated.email,
      metadata: { fields: Object.keys(req.body ?? {}) },
      ip: clientIp(req),
    });
    return ok(res, updated);
  }),
);

users.delete(
  '/:id',
  validate({ params: cmsIdParam }),
  asyncHandler(async (req, res) => {
    const actor = currentCmsUser(req);
    // cms_sessions cascades on delete, so open sessions die with the account
    // rather than staying valid until they expire.
    await service.deleteCmsUser(req.params.id!, actor.id);
    await service.recordActivity({
      actor: { id: actor.id, email: actor.email },
      action: 'cms_user.deleted',
      entityType: 'cms_user',
      entityId: req.params.id!,
      ip: clientIp(req),
    });
    return res.status(204).send();
  }),
);

router.use('/users', users);

export default router;
