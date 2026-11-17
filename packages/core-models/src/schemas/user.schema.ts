// ===========================================
// User Zod Schemas
// ===========================================

import { z } from 'zod/v4';
import { USER_ROLE } from '../constants.js';

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
  // No username is longer (users.username is varchar(100)).
  username: z.string().min(1).max(100),
  password: passwordSchema,
});

export const createUserSchema = z.object({
  username: z.string().min(1).max(100),
  email: z.string().email().max(255),
  password: passwordSchema,
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  // A role's name (roles are rows, D-310); the server refuses a name with no role.
  role: z.string().min(1).max(100).default(USER_ROLE.VIEWER),
});

export const updateUserSchema = z.object({
  email: z.string().email().max(255).optional(),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  role: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

/**
 * DELETE /users/:id query. Every working API key the user issued is disabled
 * with them (D-322); `takeOwnership` (comma-separated key ids) names keys the
 * caller takes over instead, each replaced as a leak with a new token.
 */
export const deleteUserQuerySchema = z.object({
  takeOwnership: z.string().max(4000).optional()
    .transform((v) => (v === undefined || v === '' ? [] : v.split(',')))
    .pipe(z.array(z.string().uuid()).max(100)),
});

export type DeleteUserQuery = z.infer<typeof deleteUserQuerySchema>;

/** A key taken over when its issuer was deleted: its new token, shown once. */
export interface TakenOverKey {
  readonly keyId: string;
  readonly name: string;
  readonly token: string;
}

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
