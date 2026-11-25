import { z } from 'zod/v4';
import { USER_ROLE } from '../constants.js';

/** Use at every boundary that sets a password. */
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
 * The deleted user's API keys are disabled (D-322), except those named in
 * `takeOwnership`, which pass to the caller with new tokens.
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

/** Requires the current password so a hijacked session cannot rotate credentials. */
export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

/** Lowercase, as Postgres returns ids: the checks for the caller's own id compare text. */
export const userIdParamSchema = z.object({
  id: z.string().uuid().transform((id) => id.toLowerCase()),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
