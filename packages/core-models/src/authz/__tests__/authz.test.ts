// ===========================================
// Authorization: catalog, folding grants, checking them
// ===========================================

import { describe, it, expect } from 'vitest';
import { PERMISSIONS, type Permission } from '../../constants.js';
import type { ChannelGroupId } from '../../brands.js';
import {
  PERMISSION_CATALOG, PERMISSION_CLASS, ALL_CHANNELS, foldGrants, can, holdsPermission, allChannelsOnly, serializeGrants,
} from '../index.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const LAB = 'g-lab' as ChannelGroupId;
const RAD = 'g-rad' as ChannelGroupId;

describe('PERMISSION_CATALOG', () => {
  it('describes every permission, and nothing else', () => {
    expect(Object.keys(PERMISSION_CATALOG).sort()).toEqual(Object.values(PERMISSIONS).sort());
  });

  it('never lets an API key hold an identity permission', () => {
    for (const [name, info] of Object.entries(PERMISSION_CATALOG)) {
      if (info.class === PERMISSION_CLASS.IDENTITY) expect(info.keyAllowed, name).toBe(false);
    }
  });

  it('marks what reaches every channel, and keeps it to all-channel assignments', () => {
    for (const p of ['system:info', 'collections:read', 'global_map:read', 'config_map:read'] as const) {
      expect(PERMISSION_CATALOG[p].class, p).toBe(PERMISSION_CLASS.EVERY_CHANNEL_READ);
      expect(PERMISSION_CATALOG[p].readsEveryChannel, p).toBe(true);
      expect(allChannelsOnly(p), p).toBe(true);
    }
  });

  it('lets channel and system-read permissions be scoped, and keeps trust and identity all-channel only', () => {
    expect(allChannelsOnly('messages:read')).toBe(false);
    expect(allChannelsOnly('settings:read')).toBe(false);
    expect(allChannelsOnly('settings:write')).toBe(true);
    expect(allChannelsOnly('users:write')).toBe(true);
    expect(allChannelsOnly('audit:read')).toBe(true);
  });

  it('flags the permissions that run code or reach PHI', () => {
    expect(PERMISSION_CATALOG['channels:deploy'].runsCode).toBe(true);
    expect(PERMISSION_CATALOG['global_scripts:write'].runsCode).toBe(true);
    expect(PERMISSION_CATALOG['system:restore'].runsCode).toBe(true);
    expect(PERMISSION_CATALOG['messages:read'].readsPhi).toBe(true);
    expect(PERMISSION_CATALOG['alerts:write'].readsPhi).toBe(true);
    expect(PERMISSION_CATALOG['tags' as Permission]).toBeUndefined();
  });

  it('calls only a change to who holds what as strong as admin', () => {
    const adminEquivalent = Object.entries(PERMISSION_CATALOG).filter(([, i]) => i.adminEquivalent).map(([p]) => p);
    expect(adminEquivalent.sort()).toEqual(['roles:write', 'users:write']);
  });

  it('marks backups and the audit log as reading every channel', () => {
    expect(PERMISSION_CATALOG['system:backup'].readsEveryChannel).toBe(true);
    expect(PERMISSION_CATALOG['audit:read'].readsEveryChannel).toBe(true);
    expect(PERMISSION_CATALOG['messages:read'].readsEveryChannel).toBe(false);
  });

  it('puts each permission in the class the plan gives it', () => {
    const byClass = (cls: string): string[] =>
      Object.entries(PERMISSION_CATALOG).filter(([, i]) => i.class === cls).map(([p]) => p).sort();
    expect(byClass(PERMISSION_CLASS.SYSTEM_READ)).toEqual([
      'alerts:read', 'code_templates:read', 'datasources:read', 'global_scripts:read', 'resources:read', 'settings:read',
    ]);
    expect(byClass(PERMISSION_CLASS.TRUST)).toEqual([
      'alerts:delete', 'alerts:write', 'collections:delete', 'collections:write', 'config_map:write',
      'datasources:delete', 'datasources:write', 'global_map:write', 'global_scripts:write',
      'resources:delete', 'resources:write', 'settings:write',
    ]);
    expect(byClass(PERMISSION_CLASS.IDENTITY)).toEqual([
      'audit:read', 'roles:read', 'roles:write', 'system:backup', 'system:restore', 'users:delete', 'users:read', 'users:write',
    ]);
  });
});

describe('foldGrants', () => {
  it('unions the scopes of every assignment that grants a permission', () => {
    const grants = foldGrants([
      { permissions: ['messages:read'], scope: [LAB] },
      { permissions: ['messages:read', 'channels:read'], scope: [RAD] },
    ], NOW);

    expect(grants.get('messages:read')).toEqual(new Set([LAB, RAD]));
    expect(grants.get('channels:read')).toEqual(new Set([RAD]));
    expect(grants.has('messages:delete')).toBe(false);
  });

  it('lets an all-channel assignment win over any group scope', () => {
    const grants = foldGrants([
      { permissions: ['messages:read'], scope: [LAB] },
      { permissions: ['messages:read'], scope: ALL_CHANNELS },
      { permissions: ['messages:read'], scope: [RAD] },
    ], NOW);
    expect(grants.get('messages:read')).toBe(ALL_CHANNELS);
  });

  it('never widens one permission because another is held more widely', () => {
    // "Viewer, all channels" plus "Analyst, Lab": reprocess stays on Lab.
    const grants = foldGrants([
      { permissions: ['messages:read'], scope: ALL_CHANNELS },
      { permissions: ['messages:read', 'messages:reprocess'], scope: [LAB] },
    ], NOW);
    expect(grants.get('messages:reprocess')).toEqual(new Set([LAB]));
  });

  it('drops an expired assignment', () => {
    const grants = foldGrants([
      { permissions: ['channels:deploy'], scope: [LAB], expiresAt: new Date('2026-11-16T11:59:59Z') },
      { permissions: ['channels:read'], scope: [LAB], expiresAt: new Date('2026-11-16T12:00:01Z') },
    ], NOW);
    expect(grants.has('channels:deploy')).toBe(false);
    expect(grants.has('channels:read')).toBe(true);
  });

  it('treats an assignment expiring exactly now as expired, and a null expiry as never', () => {
    const grants = foldGrants([
      { permissions: ['channels:deploy'], scope: [LAB], expiresAt: NOW },
      { permissions: ['channels:read'], scope: [LAB], expiresAt: null },
    ], NOW);
    expect(grants.has('channels:deploy')).toBe(false);
    expect(grants.has('channels:read')).toBe(true);
  });

  it('fails closed on an unreadable expiry', () => {
    const grants = foldGrants([{ permissions: ['channels:deploy'], scope: ALL_CHANNELS, expiresAt: new Date('not a date') }], NOW);
    expect(grants.has('channels:deploy')).toBe(false);
  });

  it('keeps an all-channel grant when a scoped one follows it', () => {
    const grants = foldGrants([
      { permissions: ['messages:read'], scope: ALL_CHANNELS },
      { permissions: ['messages:read'], scope: [LAB] },
    ], NOW);
    expect(grants.get('messages:read')).toBe(ALL_CHANNELS);
  });

  it('holds nothing for an empty scope', () => {
    expect(foldGrants([{ permissions: ['messages:read'], scope: [] }], NOW).has('messages:read')).toBe(false);
  });
});

describe('can', () => {
  const grants = foldGrants([
    { permissions: ['messages:read'], scope: [LAB] },
    { permissions: ['channels:read'], scope: ALL_CHANNELS },
  ], NOW);

  it('allows a permission somewhere in its scope when no channel is named', () => {
    expect(can(grants, 'messages:read')).toBe(true);
    expect(can(grants, 'messages:delete')).toBe(false);
  });

  it('allows a channel only when one of its groups is in the scope', () => {
    expect(can(grants, 'messages:read', { groupIds: [RAD, LAB] })).toBe(true);
    expect(can(grants, 'messages:read', { groupIds: [RAD] })).toBe(false);
    expect(can(grants, 'messages:read', { groupIds: [] })).toBe(false);
  });

  it('allows every channel for an all-channel grant, groups or not', () => {
    expect(can(grants, 'channels:read', { groupIds: [] })).toBe(true);
  });
});

describe('serializeGrants', () => {
  it('lists each held permission with its scope, sorted, as JSON can carry it', () => {
    const grants = foldGrants([
      { permissions: ['messages:read', 'channels:read'], scope: [RAD, LAB] },
      { permissions: ['channels:read'], scope: ALL_CHANNELS },
    ], NOW);
    expect(serializeGrants(grants)).toEqual([
      { permission: 'channels:read', scope: 'all' },
      { permission: 'messages:read', scope: [LAB, RAD] },
    ]);
  });
});

describe('holdsPermission', () => {
  it('checks a flat permission list, the shape the server sends today', () => {
    expect(holdsPermission(['channels:read'], 'channels:read')).toBe(true);
    expect(holdsPermission(['channels:read'], 'channels:write')).toBe(false);
    expect(holdsPermission(undefined, 'channels:read')).toBe(false);
  });
});
