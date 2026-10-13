import { z } from 'zod';

export const cmsLoginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
});

export const cmsRefreshSchema = z.object({
  sessionToken: z.string().min(10).max(200),
});

/**
 * CMS passwords are longer than the platform's by design: these accounts publish
 * to the public site and there is no second factor behind them.
 */
const cmsPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .regex(/[a-zA-Z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const cmsChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: cmsPassword,
});

export const cmsCreateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  password: cmsPassword,
  role: z.enum(['admin', 'editor']).default('editor'),
});

export const cmsUpdateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.enum(['admin', 'editor']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  /** Set by an admin for someone who has locked themselves out. */
  password: cmsPassword.optional(),
});

export const cmsIdParam = z.object({ id: z.string().uuid() });

export const cmsActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/* ─────────────────────────── categories ─────────────────────────── */

export const cmsCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, numbers and hyphens only')
    .optional(),
  description: z.string().trim().max(500).nullish(),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(100),
});

export const cmsUpdateCategorySchema = cmsCategorySchema.partial();

export type CmsLoginInput = z.infer<typeof cmsLoginSchema>;
export type CmsChangePasswordInput = z.infer<typeof cmsChangePasswordSchema>;
export type CmsCreateUserInput = z.infer<typeof cmsCreateUserSchema>;
export type CmsUpdateUserInput = z.infer<typeof cmsUpdateUserSchema>;
export type CmsCategoryInput = z.infer<typeof cmsCategorySchema>;
export type CmsUpdateCategoryInput = z.infer<typeof cmsUpdateCategorySchema>;
