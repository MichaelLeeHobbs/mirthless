// ===========================================
// User Zod Schemas
// ===========================================

import { z } from 'zod/v4';

export const passwordSchema = z.string().min(8).max(128);

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

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
