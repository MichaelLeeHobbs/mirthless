// Only the paths that touch no roles. Roles, the last admin, and session
// revocation on disable or delete run through the grant service's locks, and
// are proven against Postgres in test/integration/user-roles.itest.ts and
// last-admin.itest.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushResponse(value: unknown, opts?: { orderable?: boolean; forUpdate?: boolean }): void {
  selectResponses.push(() => {
    if (opts?.forUpdate) {
      return { for: vi.fn().mockResolvedValue(value) };
    }
    if (opts?.orderable) {
      return Object.assign(Promise.resolve(value), {
        orderBy: vi.fn().mockResolvedValue(value),
      });
    }
    return value;
  });
}

function nextResponse(): unknown {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  return fn ? fn() : [];
}

const mockSelectWhere = vi.fn().mockImplementation(nextResponse);
const mockSelectFrom = vi.fn().mockImplementation(() => ({
  where: mockSelectWhere, orderBy: vi.fn().mockImplementation(nextResponse), innerJoin: () => ({ where: mockSelectWhere }),
}));
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));

const mockDb = {
  select: mockSelect,
  update: mockUpdate,
  delete: mockDelete,
  transaction: mockTransaction,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('../../lib/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$12$hashed'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const { UserService } = await import('../user.service.js');

const NOW = new Date('2026-02-28T12:00:00Z');
const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';

function makeUser(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: USER_ID,
    username: 'jsmith',
    email: 'jsmith@test.com',
    firstName: 'John',
    lastName: 'Smith',
    description: null,
    roleNames: ['developer'],
    enabled: true,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function standingRow(id: string, permissions: readonly string[]): Record<string, unknown> {
  return {
    id, username: 'u', email: 'u@test.com', enabled: true, mustChangePassword: false,
    assignments: permissions.length === 0 ? [] : [{ role: 'r', admin: false, permissions, expiresAt: null, allChannels: true }],
  };
}

function pushTargetRule(targetPermissions: readonly string[], actorPermissions: readonly string[]): void {
  pushResponse([standingRow(USER_ID, targetPermissions)]);
  pushResponse([standingRow(ADMIN_ID, actorPermissions)]);
}

/** The lock, then the actor, read again for the route's permission. */
function pushAccessLock(): void {
  pushResponse([{ id: 'admin-role' }], { forUpdate: true });
  pushResponse([standingRow(ADMIN_ID, ['channels:read', 'users:write'])]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
});

describe('UserService', () => {
  describe('listUsers', () => {
    it('returns all users ordered by username, each with the roles they hold', async () => {
      const userList = [makeUser(), makeUser({ id: ADMIN_ID, username: 'admin', roleNames: ['admin', 'viewer'] })];
      pushResponse(userList, { orderable: true });

      const result = await UserService.listUsers();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[1]).toMatchObject({ role: 'admin, viewer', roles: ['admin', 'viewer'] });
      expect(result.value[1]).not.toHaveProperty('roleNames');
    });

    it('returns empty array when no users', async () => {
      pushResponse([], { orderable: true });

      const result = await UserService.listUsers();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('getUser', () => {
    it('returns user detail', async () => {
      pushResponse([makeUser()]);

      const result = await UserService.getUser(USER_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.username).toBe('jsmith');
      expect(result.value.role).toBe('developer');
    });

    it('shows a user with no live assignment as holding no role', async () => {
      pushResponse([makeUser({ roleNames: [] })]);

      const result = await UserService.getUser(USER_ID);

      expect(result.ok && result.value.role).toBe('');
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushResponse([]);

      const result = await UserService.getUser('nonexistent');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('createUser', () => {
    it('returns ALREADY_EXISTS for duplicate username', async () => {
      pushResponse([{ id: USER_ID }]);

      const result = await UserService.createUser({
        username: 'jsmith',
        email: 'new@test.com',
        password: 'password123',
        role: 'viewer',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'ALREADY_EXISTS');
    });

    it('returns ALREADY_EXISTS for duplicate email', async () => {
      pushResponse([]); // Username check passes
      pushResponse([{ id: USER_ID }]); // Email exists

      const result = await UserService.createUser({
        username: 'newuser',
        email: 'jsmith@test.com',
        password: 'password123',
        role: 'viewer',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'ALREADY_EXISTS');
    });
  });

  describe('updateUser', () => {
    it('updates user fields without touching roles', async () => {
      pushAccessLock();
      pushTargetRule(['channels:read'], ['channels:read', 'users:write']);
      pushResponse([{ id: USER_ID }], { forUpdate: true }); // the target, under lock
      pushResponse([makeUser({ email: 'updated@test.com' })]); // getUser after update

      const result = await UserService.updateUser(USER_ID, { email: 'updated@test.com' }, ADMIN_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.email).toBe('updated@test.com');
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushAccessLock();
      pushResponse([]); // the target rule finds no such user

      const result = await UserService.updateUser('nonexistent', { email: 'x@y.com' }, ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('updateUser: your own account', () => {
    it('returns SELF_ACTION when disabling self, and writes nothing', async () => {
      pushAccessLock();

      const result = await UserService.updateUser(ADMIN_ID, { enabled: false }, ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'SELF_ACTION');
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('updateUser: the target rule', () => {
    it('refuses a change to a user who holds more than the actor, and writes nothing', async () => {
      pushAccessLock();
      pushTargetRule(['channels:read', 'channels:deploy'], ['channels:read', 'users:write']);

      const result = await UserService.updateUser(USER_ID, { email: 'x@y.com' }, ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'FORBIDDEN');
      expect(result.error).toHaveProperty('details', { missing: ['channels:deploy'] });
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('returns SELF_ACTION when deleting self', async () => {
      const result = await UserService.deleteUser(ADMIN_ID, ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'SELF_ACTION');
    });
  });

  describe('changePassword', () => {
    it('resets another user\'s password', async () => {
      pushTargetRule(['channels:read'], ['channels:read', 'users:write']);
      pushResponse([{ id: USER_ID }]);
      pushAccessLock();
      pushResponse([], { orderable: true }); // the target's assignments

      const result = await UserService.changePassword(USER_ID, 'newpass123', ADMIN_ID);

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('refuses your own password, which changes only with the current one, and writes nothing', async () => {
      pushResponse([{ id: ADMIN_ID }]);

      const result = await UserService.changePassword(ADMIN_ID, 'newpass123', ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'SELF_ACTION');
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('refuses another user\'s password when that user holds more than the actor (the target rule)', async () => {
      pushTargetRule(['channels:read', 'users:write'], ['users:write']);

      const result = await UserService.changePassword(USER_ID, 'newpass123', ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'FORBIDDEN');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushResponse([]);

      const result = await UserService.changePassword('nonexistent', 'newpass123', ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('changeOwnPassword', () => {
    it('verifies the current password, updates, and clears other sessions', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as unknown as never);
      pushResponse([{ id: USER_ID, passwordHash: '$2a$12$existing' }]);

      const result = await UserService.changeOwnPassword(USER_ID, 'oldPass123', 'newPass123', 'session-1');

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalled();
    });

    it('rejects when the current password is wrong', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as unknown as never);
      pushResponse([{ id: USER_ID, passwordHash: '$2a$12$existing' }]);

      const result = await UserService.changeOwnPassword(USER_ID, 'wrong', 'newPass123', 'session-1');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INVALID_CREDENTIALS');
    });

    it('returns NOT_FOUND when the user does not exist', async () => {
      pushResponse([]);

      const result = await UserService.changeOwnPassword('nope', 'x', 'newPass123', 'session-1');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('getPermissions', () => {
    it('returns the permissions the user\'s live assignments grant', async () => {
      // The person lookup (an API key's user is not answered here, D-320), then the standing.
      pushResponse([{ id: USER_ID }]);
      pushResponse([{
        id: USER_ID, username: 'jsmith', email: 'jsmith@test.com', enabled: true, mustChangePassword: false,
        assignments: [{ role: 'viewer', admin: false, permissions: ['messages:read', 'channels:read'], expiresAt: null, allChannels: true }],
      }]);

      const result = await UserService.getPermissions(USER_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ role: 'viewer', roles: ['viewer'], permissions: ['channels:read', 'messages:read'] });
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushResponse([]);

      const result = await UserService.getPermissions('nonexistent');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns NOT_FOUND for an API key\'s user without reading its standing', async () => {
      // The person filter leaves the key's user out, so the lookup comes back empty.
      pushResponse([]);
      pushResponse([{ id: USER_ID, username: 'api-key:k', email: 'k@api-key.invalid', enabled: true, mustChangePassword: false, assignments: [] }]);

      const result = await UserService.getPermissions(USER_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('unlockUser', () => {
    it('resets lockout state', async () => {
      pushTargetRule([], ['users:write']);
      pushResponse([{ id: USER_ID }]);

      const result = await UserService.unlockUser(USER_ID, ADMIN_ID);

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushResponse([]);

      const result = await UserService.unlockUser('nonexistent', ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });
});
