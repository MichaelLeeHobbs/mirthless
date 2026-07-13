// ===========================================
// User Zod Schemas
// ===========================================

import { z } from 'zod/v4';

/**
 * Password policy: 8-128 chars with basic complexity — at least one letter and
 * one digit. Enforced at every boundary that sets a password (create user,
 * admin reset, self-service change).
 */
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), {
    message: 'Password must contain at least one letter and one number',
  });

export const loginSchema = z.object({
  username: z.string().min(1),
  password: passwordSchema,
});

export const createUserSchema = z.object({
  username: z.string().min(1).max(100),
  email: z.string().email().max(255),
  password: passwordSchema,
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  role: z.enum(['admin', 'deployer', 'developer', 'viewer']).default('viewer'),
});

export const updateUserSchema = z.object({
  email: z.string().email().max(255).optional(),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  role: z.enum(['admin', 'deployer', 'developer', 'viewer']).optional(),
  enabled: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  newPassword: passwordSchema,
});

/**
 * Self-service password change. Requires the caller's current password so a
 * hijacked session cannot silently rotate credentials.
 */
export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
