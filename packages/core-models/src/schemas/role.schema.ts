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

// ----- Assignments -----

/** The most assignments one user may hold; a person has a handful of jobs. */
export const MAX_ASSIGNMENTS_PER_USER = 50;

/**
 * One assignment: a role over every channel (`groupIds` null) or over the
 * channels in a set of groups, chosen explicitly (plan section 1), until an
 * optional expiry, with an optional reason recorded with it.
 */
export const assignmentInputSchema = z.strictObject({
  roleId: z.string().uuid(),
  groupIds: z.array(z.string().uuid()).min(1).max(100)
    .refine((list) => new Set(list).size === list.length, 'A group is listed twice.')
    .nullable(),
  expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
  reason: z.string().trim().max(500).nullable().default(null).transform((v) => (v === '' ? null : v)),
});

/** Every assignment a user should hold, replacing what they hold now. */
export const setAssignmentsSchema = z.strictObject({
  assignments: z.array(assignmentInputSchema).max(MAX_ASSIGNMENTS_PER_USER),
});

export type AssignmentInput = z.infer<typeof assignmentInputSchema>;
export type SetAssignmentsInput = z.infer<typeof setAssignmentsSchema>;

/** An assignment as the API returns it. */
export interface AssignmentView {
  readonly id: string;
  readonly roleId: string;
  readonly roleName: string;
  /** null: every channel. */
  readonly groupIds: readonly string[] | null;
  readonly expiresAt: string | null;
  readonly reason: string | null;
  /** Not yet expired. */
  readonly live: boolean;
  readonly createdAt: string;
}

/** One way a person reaches a channel: an assignment of a role over a scope that covers it. */
export interface AccessPath {
  readonly role: string;
  /** The channel permissions this assignment gives on the channel. */
  readonly permissions: readonly string[];
  /** null: every channel. */
  readonly groupIds: readonly string[] | null;
  readonly expiresAt: string | null;
}

/** Who can access one channel now, and how (D-310, plan section 8). */
export interface ChannelAccessView {
  /** Each enabled person whose live assignments cover the channel, with the channel permissions those give. */
  readonly people: ReadonlyArray<{
    readonly userId: string;
    readonly username: string;
    readonly permissions: readonly string[];
    readonly through: readonly AccessPath[];
  }>;
  /** People who can change or deploy code in any scope: through that code they reach every channel, unrecorded. */
  readonly throughCode: ReadonlyArray<{ readonly userId: string; readonly username: string }>;
  /** People who read data every channel shares (server log, maps, collections). */
  readonly throughSharedData: ReadonlyArray<{ readonly userId: string; readonly username: string }>;
}

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
