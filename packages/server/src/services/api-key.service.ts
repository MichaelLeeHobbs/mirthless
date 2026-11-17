// ===========================================
// API Key Service
// ===========================================
// Issues and manages API keys, and resolves a key token to its principal
// (D-313, RBAC plan section 7). A key is a users row of kind 'api_key' holding
// one assignment of a private key role, so the guards, the audit log and the
// access views treat it like any principal. Every write here records its grant
// rows the way the grant service does (ROLE_CREATED, ASSIGNMENTS_CHANGED,
// USER_ENABLED_CHANGED), so the access replay (D-319) follows keys too.
//
// The within rule holds twice at issue: the issuer holds every key permission
// over the key's scope now, and still will just before the key ends, so a key
// never outlasts the issuer access that covers it. Every request with the key
// checks it again against the issuer's grants at that moment, so a key stops
// working as soon as its issuer is disabled or loses what the key holds.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { ALL_CHANNELS, USER_KIND, type FoldedGrants } from '@galvanigraph/core-models';
import { alias } from 'drizzle-orm/pg-core';
import {
  API_KEY_STATUS, AUDIT_ACTION, type ApiKeyStatus, type ApiKeyView, type CreateApiKeyInput, type IssuedApiKey, type Permission,
} from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { queryUserStanding, type UserStanding } from '../lib/principal.js';
import { keyToken, newKeySecret, parseKeyToken } from '../lib/api-key-token.js';
import { hashToken, matchesTokenHash } from '../lib/token-hash.js';
import { apiKeys, assignmentGroups, assignments, rolePermissions, roles, users } from '../db/schema/index.js';
import { AuditService, type AuditTransaction } from './audit.service.js';
import {
  GrantService, actorGrants, assertActorHoldsOver, assertScopeAllowed, holdsOver, lockScopeGroups,
  type GrantActor, type Reader, type ScopeIds,
} from './grant.service.js';

/** A password hash no password matches: a key's user never signs in with one. */
const NO_PASSWORD = '!';

const issuer = alias(users, 'issuer');

/** A key's status from its row: revoked, then ended, then disabled. */
function statusOf(row: { revokedAt: Date | null; expiresAt: Date; enabled: boolean }, now: number): ApiKeyStatus {
  if (row.revokedAt !== null) return API_KEY_STATUS.REVOKED;
  if (row.expiresAt.getTime() <= now) return API_KEY_STATUS.EXPIRED;
  return row.enabled ? API_KEY_STATUS.ACTIVE : API_KEY_STATUS.DISABLED;
}

/** Keys as the API shows them, with their permissions and scope; one key when `id` is given. */
async function readKeys(reader: Reader, id?: string): Promise<ApiKeyView[]> {
  const rows = await reader.select({
    id: apiKeys.id, name: apiKeys.name, description: apiKeys.description, reason: apiKeys.reason,
    expiresAt: apiKeys.expiresAt, revokedAt: apiKeys.revokedAt, revokeReason: apiKeys.revokeReason,
    lastUsedAt: apiKeys.lastUsedAt, lastUsedIp: apiKeys.lastUsedIp, createdAt: apiKeys.createdAt,
    enabled: users.enabled, issuerId: issuer.id, issuerName: issuer.username,
    assignmentId: assignments.id, roleId: assignments.roleId, allChannels: assignments.allChannels,
  }).from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .innerJoin(issuer, eq(issuer.id, apiKeys.issuedBy))
    .innerJoin(assignments, eq(assignments.userId, apiKeys.userId))
    .where(id === undefined ? undefined : eq(apiKeys.id, id))
    .orderBy(asc(apiKeys.name), asc(apiKeys.id));
  if (rows.length === 0) return [];
  const perms = await reader.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission }).from(rolePermissions)
    .where(inArray(rolePermissions.roleId, rows.map((r) => r.roleId)));
  const groups = await reader.select({ assignmentId: assignmentGroups.assignmentId, groupId: assignmentGroups.channelGroupId }).from(assignmentGroups)
    .where(inArray(assignmentGroups.assignmentId, rows.map((r) => r.assignmentId)));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id, name: r.name, description: r.description, reason: r.reason,
    permissions: perms.filter((p) => p.roleId === r.roleId).map((p) => p.permission).sort(),
    groupIds: r.allChannels ? null : groups.filter((g) => g.assignmentId === r.assignmentId).map((g) => g.groupId).sort(),
    status: statusOf(r, now),
    expiresAt: r.expiresAt.toISOString(),
    issuedBy: { id: r.issuerId, username: r.issuerName },
    revokedAt: r.revokedAt?.toISOString() ?? null, revokeReason: r.revokeReason,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null, lastUsedIp: r.lastUsedIp,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * The within rule for a key, twice: the actor holds every permission over the
 * scope now, and still will just before `expiresAt`.
 */
async function assertActorCovers(tx: AuditTransaction, actorId: string | null, permissions: readonly Permission[], scope: ScopeIds, expiresAt: Date): Promise<void> {
  assertActorHoldsOver(await actorGrants(tx, actorId), 'this key', permissions, scope);
  const atEnd = actorId === null ? null : await queryUserStanding(tx, actorId, new Date(expiresAt.getTime() - 1));
  try {
    assertActorHoldsOver(atEnd?.enabled === true ? atEnd.grants : new Map(), 'this key', permissions, scope);
  } catch {
    throw new ServiceError('FORBIDDEN', 'A key cannot outlast your own access: some of what it holds ends for you before the key would. Pick an earlier end.');
  }
}

/** Whether `issuer` holds every permission `key` holds, each over the key's scope for it. */
function issuerCovers(issuer: FoldedGrants, key: FoldedGrants): boolean {
  for (const [permission, scope] of key) {
    if (!holdsOver(issuer, permission, scope === ALL_CHANNELS ? null : [...scope])) return false;
  }
  return true;
}

/** The key's row, locked for a change, or NOT_FOUND. */
async function lockKey(tx: AuditTransaction, id: string): Promise<{ userId: string; revokedAt: Date | null; expiresAt: Date }> {
  const [row] = await tx.select({ userId: apiKeys.userId, revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt })
    .from(apiKeys).where(eq(apiKeys.id, id)).for('no key update');
  if (!row) throw new ServiceError('NOT_FOUND', `API key not found: ${id}`);
  return row;
}

/** Insert the key's principal, private role and assignment; returns the user and role ids. */
async function insertPrincipal(tx: AuditTransaction, keyId: string, input: CreateApiKeyInput, expiresAt: Date, actorId: string): Promise<{ userId: string; roleId: string }> {
  const [user] = await tx.insert(users).values({
    username: `api-key:${keyId}`, email: `${keyId}@api-key.invalid`, passwordHash: NO_PASSWORD, kind: USER_KIND.API_KEY,
  }).returning({ id: users.id });
  const [role] = await tx.insert(roles).values({ name: `api-key:${keyId}`, description: `API key ${input.name}`, keyRole: true })
    .returning({ id: roles.id });
  if (!user || !role) throw new ServiceError('INTERNAL', 'Failed to create the key');
  await tx.insert(rolePermissions).values(input.permissions.map((permission) => ({ roleId: role.id, permission })));
  const [assignment] = await tx.insert(assignments).values({
    userId: user.id, roleId: role.id, allChannels: input.groupIds === null, expiresAt, reason: input.reason, createdBy: actorId,
  }).returning({ id: assignments.id });
  if (input.groupIds !== null) {
    await tx.insert(assignmentGroups).values([...input.groupIds].sort().map((channelGroupId) => ({ assignmentId: assignment!.id, channelGroupId })));
  }
  return { userId: user.id, roleId: role.id };
}

/** The grant rows an issue records, shaped as the grant service records them, plus the issue itself. */
async function recordIssue(tx: AuditTransaction, ids: { keyId: string; userId: string; roleId: string }, input: CreateApiKeyInput, expiresAt: Date, actor: GrantActor): Promise<void> {
  const base = { outcome: 'SUCCESS', userId: actor.userId, ipAddress: actor.ipAddress ?? null } as const;
  const permissions = [...input.permissions].sort();
  const scope = input.groupIds === null ? 'all' : [...input.groupIds].sort();
  await AuditService.recordInTx(tx, { ...base, action: AUDIT_ACTION.ROLE_CREATED, attributes: { roleId: ids.roleId, name: `api-key:${ids.keyId}`, permissions, apiKeyId: ids.keyId } });
  await AuditService.recordInTx(tx, {
    ...base, action: AUDIT_ACTION.ASSIGNMENTS_CHANGED,
    attributes: { targetUserId: ids.userId, before: [], after: [{ roleId: ids.roleId, role: `api-key:${ids.keyId}`, scope, expiresAt: expiresAt.toISOString(), reason: input.reason }] },
  });
  await AuditService.recordInTx(tx, {
    ...base, action: AUDIT_ACTION.API_KEY_ISSUED,
    attributes: { apiKeyId: ids.keyId, keyUserId: ids.userId, name: input.name, permissions, scope, expiresAt: expiresAt.toISOString(), reason: input.reason },
  });
}

export class ApiKeyService {
  /** Every key, by name. Never a secret. */
  static async list(): Promise<ApiKeyView[]> {
    return readKeys(db);
  }

  /** One key, or NOT_FOUND. */
  static async get(id: string): Promise<ApiKeyView> {
    const [key] = await readKeys(db, id);
    if (!key) throw new ServiceError('NOT_FOUND', `API key not found: ${id}`);
    return key;
  }

  /**
   * Issue a key holding `input.permissions` over `input.groupIds` until
   * `input.expiresAt`, within what the actor holds now and then. The token is
   * in the answer only; the server keeps its secret's hash.
   */
  static async issue(input: CreateApiKeyInput, actor: GrantActor): Promise<IssuedApiKey> {
    const expiresAt = new Date(input.expiresAt);
    if (expiresAt.getTime() <= Date.now()) throw new ServiceError('INVALID_INPUT', 'Pick an end time in the future');
    if (actor.userId === null) throw new ServiceError('FORBIDDEN', 'Issuing a key needs a signed-in actor');
    const actorId = actor.userId;
    const keyId = randomUUID();
    const secret = newKeySecret();
    await db.transaction(async (tx) => {
      const scope: ScopeIds = input.groupIds;
      await lockScopeGroups(tx, [scope]);
      assertScopeAllowed('An API key', input.permissions, scope);
      await assertActorCovers(tx, actorId, input.permissions, scope, expiresAt);
      const ids = await insertPrincipal(tx, keyId, input, expiresAt, actorId);
      await tx.insert(apiKeys).values({
        id: keyId, userId: ids.userId, name: input.name, description: input.description, secretHash: hashToken(secret),
        issuedBy: actorId, reason: input.reason, expiresAt,
      });
      await recordIssue(tx, { keyId, ...ids }, input, expiresAt, actor);
    });
    return { key: await ApiKeyService.get(keyId), token: keyToken(keyId, secret) };
  }

  /**
   * Enable or disable a key. Anyone who manages keys may disable one; enabling
   * needs the key's grants within the actor's, now and until the key ends. A
   * revoked key stays off.
   */
  static async setEnabled(id: string, enabled: boolean, actor: GrantActor): Promise<ApiKeyView> {
    await db.transaction(async (tx) => {
      const key = await lockKey(tx, id);
      if (key.revokedAt !== null) throw new ServiceError('CONFLICT', 'The key is revoked; issue a new one');
      if (enabled && key.expiresAt.getTime() <= Date.now()) throw new ServiceError('CONFLICT', 'The key has ended; issue a new one');
      const [current] = await tx.select({ enabled: users.enabled }).from(users).where(eq(users.id, key.userId));
      if (current?.enabled === enabled) return;
      if (enabled) {
        const [held] = await readKeys(tx, id);
        await assertActorCovers(tx, actor.userId, (held?.permissions ?? []) as Permission[], held?.groupIds ?? null, key.expiresAt);
      }
      await tx.update(users).set({ enabled, updatedAt: new Date() }).where(eq(users.id, key.userId));
      await GrantService.recordEnabledChange(tx, key.userId, enabled, actor);
    });
    return ApiKeyService.get(id);
  }

  /** Revoke a key for good, with a reason: its secret stops working and it cannot be enabled again. */
  static async revoke(id: string, reason: string, actor: GrantActor): Promise<ApiKeyView> {
    await db.transaction(async (tx) => {
      const key = await lockKey(tx, id);
      if (key.revokedAt !== null) throw new ServiceError('CONFLICT', 'The key is already revoked');
      const now = new Date();
      await tx.update(apiKeys).set({ revokedAt: now, revokedBy: actor.userId, revokeReason: reason, updatedAt: now }).where(eq(apiKeys.id, id));
      const [user] = await tx.update(users).set({ enabled: false, updatedAt: now })
        .where(and(eq(users.id, key.userId), eq(users.enabled, true))).returning({ id: users.id });
      if (user) await GrantService.recordEnabledChange(tx, key.userId, false, actor);
      await AuditService.recordInTx(tx, {
        action: AUDIT_ACTION.API_KEY_REVOKED, outcome: 'SUCCESS', userId: actor.userId, ipAddress: actor.ipAddress ?? null,
        attributes: { apiKeyId: id, keyUserId: key.userId, reason },
      });
    });
    return ApiKeyService.get(id);
  }

  /**
   * The principal behind `token`, or null for anything that is not a live,
   * matching key: malformed, unknown, revoked, ended, a wrong secret, or an
   * issuer who is disabled or no longer holds what the key holds. The caller
   * answers every null the same way.
   */
  static async resolve(token: string): Promise<{ readonly keyId: string; readonly standing: UserStanding } | null> {
    const parsed = parseKeyToken(token);
    if (!parsed) return null;
    const [row] = await db.select({ userId: apiKeys.userId, issuedBy: apiKeys.issuedBy, secretHash: apiKeys.secretHash, revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt })
      .from(apiKeys).where(eq(apiKeys.id, parsed.keyId));
    if (!row || !matchesTokenHash(parsed.secret, row.secretHash)) return null;
    if (row.revokedAt !== null || row.expiresAt.getTime() <= Date.now()) return null;
    const standing = await queryUserStanding(db, row.userId);
    if (standing?.enabled !== true) return null;
    const issuer = await queryUserStanding(db, row.issuedBy);
    if (issuer?.enabled !== true || !issuerCovers(issuer.grants, standing.grants)) return null;
    return { keyId: parsed.keyId, standing };
  }

  /** Note a key's last use. The caller throttles it to once a minute per key. */
  static async touch(id: string, ipAddress: string | null): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date(), lastUsedIp: ipAddress }).where(eq(apiKeys.id, id));
  }
}
