import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address');

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?\d{1,3}[- ]?)?\d{10}$/, 'Enter a valid 10-digit phone number');

/**
 * Deliberately not requiring symbol classes: length is what actually resists
 * offline cracking, and complexity rules push users toward "Password1!".
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: emailSchema,
  phone: phoneSchema.optional(),
  password: passwordSchema,
  role: z.enum(['customer', 'organizer']).default('customer'),
  // Supplied when role = organizer
  organizerName: z.string().trim().min(2).max(120).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

export const requestOtpSchema = z.object({
  email: emailSchema,
  purpose: z.enum(['login', 'signup', 'reset_password', 'verify_email']).default('login'),
});

export const verifyOtpSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from your email'),
  purpose: z.enum(['login', 'signup', 'reset_password', 'verify_email']).default('login'),
  // Only used with purpose = reset_password
  newPassword: passwordSchema.optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.optional().nullable(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  cityId: z.string().uuid().optional().nullable(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
