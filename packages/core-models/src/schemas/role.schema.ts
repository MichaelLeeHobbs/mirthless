// D-310. The admin role is locked: the server refuses to change or delete it.

import { z } from 'zod/v4';
import { PERMISSIONS, type Permission } from '../constants.js';

const PERMISSION_VALUES = Object.values(PERMISSIONS) as [Permission, ...Permission[]];

export const roleNameSchema = z.string().trim().min(1).max(100)
  .refine((v) => [...v].every((c) => { const code = c.charCodeAt(0); return code >= 0x20 && code !== 0x7f; }), 'A role name cannot hold control characters.');

export const rolePermissionsSchema = z.array(z.enum(PERMISSION_VALUES)).max(PERMISSION_VALUES.length)
  .refine((list) => new Set(list).size === list.length, 'A permission is listed twice.');

export const createRoleSchema = z.strictObject({
  name: roleNameSchema,
  description: z.string().max(1000).default(''),
  permissions: rolePermissionsSchema,
  /** Recorded in the audit log. */
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

/** A person has a handful of jobs. */
export const MAX_ASSIGNMENTS_PER_USER = 50;

/** `groupIds` null: every channel, chosen explicitly (plan section 1). */
export const assignmentInputSchema = z.strictObject({
  roleId: z.string().uuid(),
  groupIds: z.array(z.string().uuid()).min(1).max(100)
    .refine((list) => new Set(list).size === list.length, 'A group is listed twice.')
    .nullable(),
  expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
  reason: z.string().trim().max(500).nullable().default(null).transform((v) => (v === '' ? null : v)),
});

/** Replaces what the user holds now. */
export const setAssignmentsSchema = z.strictObject({
  assignments: z.array(assignmentInputSchema).max(MAX_ASSIGNMENTS_PER_USER),
});

export type AssignmentInput = z.infer<typeof assignmentInputSchema>;
export type SetAssignmentsInput = z.infer<typeof setAssignmentsSchema>;

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

export interface AccessPath {
  readonly role: string;
  /** The channel permissions this assignment gives on the channel. */
  readonly permissions: readonly string[];
  /** null: every channel. */
  readonly groupIds: readonly string[] | null;
  readonly expiresAt: string | null;
}

/** `asOf` rebuilds the answer for a past time from the audit log. */
export const channelAccessQuerySchema = z.object({
  asOf: z.string().datetime({ offset: true }).optional(),
});

export type ChannelAccessQuery = z.infer<typeof channelAccessQuerySchema>;

/** See D-310 and plan section 8. */
export interface ChannelAccessView {
  /** The time the answer was rebuilt for; null for now. */
  readonly asOf: string | null;
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
