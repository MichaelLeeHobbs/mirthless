// ===========================================
// Role Schemas
// ===========================================
// Roles are rows an admin creates, edits and clones (D-310). The admin role is
// locked; the server refuses to change or delete it.

import { z } from 'zod/v4';
import { PERMISSIONS, type Permission } from '../constants.js';

const PERMISSION_VALUES = Object.values(PERMISSIONS) as [Permission, ...Permission[]];

/** A role's name: one line of printable text. */
export const roleNameSchema = z.string().trim().min(1).max(100)
  .refine((v) => [...v].every((c) => { const code = c.charCodeAt(0); return code >= 0x20 && code !== 0x7f; }), 'A role name cannot hold control characters.');

/** A role's permissions: known names, each at most once. */
export const rolePermissionsSchema = z.array(z.enum(PERMISSION_VALUES)).max(PERMISSION_VALUES.length)
  .refine((list) => new Set(list).size === list.length, 'A permission is listed twice.');

export const createRoleSchema = z.strictObject({
  name: roleNameSchema,
  description: z.string().max(1000).default(''),
  permissions: rolePermissionsSchema,
  /** The role this one was cloned from, recorded in the audit log. */
  clonedFrom: z.string().uuid().optional(),
});

export const updateRoleSchema = z.strictObject({
  name: roleNameSchema.optional(),
  description: z.string().max(1000).optional(),
  permissions: rolePermissionsSchema.optional(),
});

export const roleIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
