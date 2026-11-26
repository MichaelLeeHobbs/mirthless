// A key is a users row of kind 'api_key' holding one assignment of a private
// key role (D-313), so the guards, the audit log and the access views treat it
// like any principal. Every write here records its grant rows the way the grant
// service does, so the access replay (D-319) follows keys too.
//
// The within rule holds twice at issue: the issuer holds every key permission
// over the key's scope now, and still will just before the key ends. Every
// request with the key checks it again against the issuer's grants at that
// moment, so a key stops as soon as its issuer is disabled or loses what it holds.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { USER_KIND } from '@galvanigraph/core-models';
import { alias } from 'drizzle-orm/pg-core';
import {
  API_KEY_STATUS, AUDIT_ACTION, PERMISSIONS, type ApiKeyStatus, type ApiKeyView, type CreateApiKeyInput, type IssuedApiKey, type Permission,
} from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { queryUserStanding, type UserStanding } from '../lib/principal.js';
import { keyToken, newKeySecret, parseKeyToken } from '../lib/api-key-token.js';
import { hashToken, matchesTokenHash } from '../lib/token-hash.js';
import { apiKeys, assignmentGroups, assignments, rolePermissions, roles, users } from '../db/schema/index.js';
import { AuditService, type AuditTransaction } from './audit.service.js';
import {
  GrantService, actorGrants, assertActorHoldsOver, assertScopeAllowed, issuerCovers, keyStillCovered, lockAccessFor, lockScopeGroups,
  type GrantActor, type Reader, type ScopeIds,
} from './grant.service.js';

const PLANNED_REPLACE_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;

/** A password hash no password matches: a key's user never signs in with one. */
const NO_PASSWORD = '!';

const issuer = alias(users, 'issuer');

function statusOf(row: { revokedAt: Date | null; expiresAt: Date; enabled: boolean }, now: number): ApiKeyStatus {
  if (row.revokedAt !== null) return API_KEY_STATUS.REVOKED;
  if (row.expiresAt.getTime() <= now) return API_KEY_STATUS.EXPIRED;
  return row.enabled ? API_KEY_STATUS.ACTIVE : API_KEY_STATUS.DISABLED;
}

async function readKeys(reader: Reader, id?: string): Promise<ApiKeyView[]> {
  const rows = await reader.select({
    id: apiKeys.id, name: apiKeys.name, description: apiKeys.description, reason: apiKeys.reason,
    expiresAt: apiKeys.expiresAt, revokedAt: apiKeys.revokedAt, revokeReason: apiKeys.revokeReason,
    lastUsedAt: apiKeys.lastUsedAt, lastUsedIp: apiKeys.lastUsedIp, createdAt: apiKeys.createdAt,
    previousSecretUntil: apiKeys.previousSecretUntil,
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
    previousSecretUntil: r.previousSecretUntil?.toISOString() ?? null,
  }));
}

async function assertActorCovers(tx: AuditTransaction, actorId: string | null, permissions: readonly Permission[], scope: ScopeIds, expiresAt: Date): Promise<void> {
  assertActorHoldsOver(await actorGrants(tx, actorId), 'this key', permissions, scope);
  const atEnd = await actorGrants(tx, actorId, expiresAt);
  try {
    assertActorHoldsOver(atEnd, 'this key', permissions, scope, expiresAt);
  } catch {
    throw new ServiceError('FORBIDDEN', 'A key cannot outlast your own access: some of what it holds ends for you before the key would. Pick an earlier end.');
  }
}

function secretMatches(secret: string, row: { secretHash: string; previousSecretHash: string | null; previousSecretUntil: Date | null }): boolean {
  if (matchesTokenHash(secret, row.secretHash)) return true;
  return row.previousSecretHash !== null && row.previousSecretUntil !== null && row.previousSecretUntil.getTime() > Date.now()
    && matchesTokenHash(secret, row.previousSecretHash);
}

/** After the access lock: a narrowing of the key's issuer holds that and waits for the key. */
async function lockKey(tx: AuditTransaction, id: string): Promise<{ userId: string; name: string; revokedAt: Date | null; expiresAt: Date; issuedBy: string; secretHash: string }> {
  const [row] = await tx.select({
    userId: apiKeys.userId, name: apiKeys.name, revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt, issuedBy: apiKeys.issuedBy,
    secretHash: apiKeys.secretHash,
  })
    .from(apiKeys).where(eq(apiKeys.id, id)).for('no key update');
  if (!row) throw new ServiceError('NOT_FOUND', `API key not found: ${id}`);
  return row;
}

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
  /** Never includes a secret. */
  static async list(): Promise<ApiKeyView[]> {
    return readKeys(db);
  }

  static async get(id: string): Promise<ApiKeyView> {
    const [key] = await readKeys(db, id);
    if (!key) throw new ServiceError('NOT_FOUND', `API key not found: ${id}`);
    return key;
  }

  /** The token is in the answer only; the server keeps its secret's hash. */
  static async issue(input: CreateApiKeyInput, actor: GrantActor): Promise<IssuedApiKey> {
    const expiresAt = new Date(input.expiresAt);
    if (expiresAt.getTime() <= Date.now()) throw new ServiceError('INVALID_INPUT', 'Pick an end time in the future');
    if (actor.userId === null) throw new ServiceError('FORBIDDEN', 'Issuing a key needs a signed-in actor');
    const actorId = actor.userId;
    const keyId = randomUUID();
    const secret = newKeySecret();
    await db.transaction(async (tx) => {
      const scope: ScopeIds = input.groupIds;
      await lockAccessFor(tx, actorId, PERMISSIONS.API_KEYS_MANAGE);
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
   * Anyone who manages keys may disable one; enabling needs the key's grants
   * within the actor's, now and until the key ends.
   */
  static async setEnabled(id: string, enabled: boolean, actor: GrantActor): Promise<ApiKeyView> {
    await db.transaction(async (tx) => {
      await lockAccessFor(tx, actor.userId, PERMISSIONS.API_KEYS_MANAGE);
      const key = await lockKey(tx, id);
      if (key.revokedAt !== null) throw new ServiceError('CONFLICT', 'The key is revoked; issue a new one');
      if (enabled && key.expiresAt.getTime() <= Date.now()) throw new ServiceError('CONFLICT', 'The key has ended; issue a new one');
      const [current] = await tx.select({ enabled: users.enabled }).from(users).where(eq(users.id, key.userId));
      if (current?.enabled === enabled) return;
      if (enabled) {
        // A key whose issuer is disabled never works (resolve): replacing it is how it comes back (D-322).
        const [issuer] = await tx.select({ enabled: users.enabled }).from(users).where(eq(users.id, key.issuedBy));
        if (issuer?.enabled !== true) throw new ServiceError('CONFLICT', 'Its issuer is disabled; replace the key to take it over');
        // Nor does one whose issuer was narrowed, which is how such a key came to be disabled (#450).
        if (!(await keyStillCovered(tx, { keyUserId: key.userId, issuedBy: key.issuedBy, expiresAt: key.expiresAt }))) {
          throw new ServiceError('CONFLICT', 'Its issuer no longer holds what the key holds; replace the key to take it over');
        }
        const [held] = await readKeys(tx, id);
        await assertActorCovers(tx, actor.userId, (held?.permissions ?? []) as Permission[], held?.groupIds ?? null, key.expiresAt);
      }
      await tx.update(users).set({ enabled, updatedAt: new Date() }).where(eq(users.id, key.userId));
      await GrantService.recordEnabledChange(tx, key.userId, enabled, actor);
    });
    return ApiKeyService.get(id);
  }

  static async revoke(id: string, reason: string, actor: GrantActor): Promise<ApiKeyView> {
    await db.transaction(async (tx) => {
      // revoked_by's foreign key waits on an actor being disabled with a new email, who waits on the key.
      await lockAccessFor(tx, actor.userId, PERMISSIONS.API_KEYS_MANAGE);
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

  /** The caller answers every null the same way. */
  static async resolve(token: string): Promise<{ readonly keyId: string; readonly standing: UserStanding } | null> {
    const parsed = parseKeyToken(token);
    if (!parsed) return null;
    const [row] = await db.select({
      userId: apiKeys.userId, issuedBy: apiKeys.issuedBy, secretHash: apiKeys.secretHash, revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt,
      previousSecretHash: apiKeys.previousSecretHash, previousSecretUntil: apiKeys.previousSecretUntil,
    }).from(apiKeys).where(eq(apiKeys.id, parsed.keyId));
    if (!row || !secretMatches(parsed.secret, row)) return null;
    const now = Date.now();
    if (row.revokedAt !== null || row.expiresAt.getTime() <= now) return null;
    const standing = await queryUserStanding(db, row.userId);
    if (standing?.enabled !== true) return null;
    // A disabled issuer covers nothing: a leaver's key stops with them (D-322).
    const issuer = await queryUserStanding(db, row.issuedBy);
    if (issuer?.enabled !== true || !issuerCovers(issuer.grants, standing.grants)) return null;
    return { keyId: parsed.keyId, standing };
  }

  /**
   * Only the key's own issuer may choose a planned replace, which keeps the old
   * secret working: anyone else replacing a key may be doing so because its
   * owner is leaving (D-322).
   */
  static async replace(id: string, mode: 'leak' | 'planned', actor: GrantActor): Promise<IssuedApiKey> {
    if (actor.userId === null) throw new ServiceError('FORBIDDEN', 'Replacing a key needs a signed-in actor');
    const token = await db.transaction(async (tx) => (await ApiKeyService.replaceInTx(tx, id, mode, actor)).token);
    return { key: await ApiKeyService.get(id), token };
  }

  /**
   * With `fromLeaver`, the key must be that user's: taking ownership when they
   * are disabled (D-322), always as a leak.
   */
  static async replaceInTx(tx: AuditTransaction, id: string, mode: 'leak' | 'planned', actor: GrantActor, fromLeaver?: string): Promise<{ readonly name: string; readonly token: string }> {
    if (actor.userId === null) throw new ServiceError('FORBIDDEN', 'Replacing a key needs a signed-in actor');
    await lockAccessFor(tx, actor.userId, PERMISSIONS.API_KEYS_MANAGE);
    const key = await lockKey(tx, id);
    if (fromLeaver !== undefined && key.issuedBy !== fromLeaver) throw new ServiceError('INVALID_INPUT', `API key ${id} was not issued by this user`);
    if (mode === 'planned' && key.issuedBy !== actor.userId) {
      throw new ServiceError('INVALID_INPUT', 'Only the key\'s issuer can keep its old secret working; replace it as a leak');
    }
    if (fromLeaver !== undefined) {
      const [keyUser] = await tx.select({ enabled: users.enabled }).from(users).where(eq(users.id, key.userId));
      if (keyUser?.enabled !== true) throw new ServiceError('CONFLICT', `API key ${key.name} is already disabled; replace it from the API keys page`);
    }
    if (key.revokedAt !== null) throw new ServiceError('CONFLICT', 'The key is revoked; issue a new one');
    if (key.expiresAt.getTime() <= Date.now()) throw new ServiceError('CONFLICT', 'The key has ended; issue a new one');
    const [held] = await readKeys(tx, id);
    await assertActorCovers(tx, actor.userId, (held?.permissions ?? []) as Permission[], held?.groupIds ?? null, key.expiresAt);
    const keepOld = mode === 'planned';
    const previousSecretUntil = keepOld ? new Date(Math.min(Date.now() + PLANNED_REPLACE_OVERLAP_MS, key.expiresAt.getTime())) : null;
    const secret = newKeySecret();
    await tx.update(apiKeys).set({
      secretHash: hashToken(secret), issuedBy: actor.userId,
      previousSecretHash: keepOld ? key.secretHash : null, previousSecretUntil, updatedAt: new Date(),
    }).where(eq(apiKeys.id, id));
    await AuditService.recordInTx(tx, {
      action: AUDIT_ACTION.API_KEY_REPLACED, outcome: 'SUCCESS', userId: actor.userId, ipAddress: actor.ipAddress ?? null,
      attributes: {
        apiKeyId: id, keyUserId: key.userId, mode, previousIssuer: key.issuedBy, previousSecretUntil: previousSecretUntil?.toISOString() ?? null,
        ...(fromLeaver !== undefined ? { tookOwnershipFrom: fromLeaver } : {}),
      },
    });
    return { name: key.name, token: keyToken(id, secret) };
  }

  /** Before taking a leaver's keys over, in key-user order as every other key change. The caller holds the access lock. */
  static async lockForTakeover(tx: AuditTransaction, keyIds: readonly string[]): Promise<void> {
    if (keyIds.length === 0) return;
    await tx.select({ id: apiKeys.id }).from(apiKeys).where(inArray(apiKeys.id, [...keyIds])).orderBy(asc(apiKeys.userId)).for('no key update');
  }

  /** The caller throttles this per key (auth.middleware.ts). */
  static async touch(id: string, ipAddress: string | null): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date(), lastUsedIp: ipAddress }).where(eq(apiKeys.id, id));
  }
}
