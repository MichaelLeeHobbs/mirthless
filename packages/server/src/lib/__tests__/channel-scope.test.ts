// ===========================================
// Channel scope: which channels a caller's grants cover (D-310)
// ===========================================
// The database half (expanding groups to channel ids) is proven against
// Postgres in test/integration/channel-scope.itest.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';
import { ALL_CHANNELS, foldGrants, type AssignmentGrant, type ChannelGroupId } from '@galvanigraph/core-models';

const { rows } = vi.hoisted(() => ({ rows: vi.fn<() => Promise<readonly { channelId: string }[]>>() }));
vi.mock('../db.js', () => ({
  db: { selectDistinct: () => ({ from: () => ({ where: () => rows() }) }) },
}));

const { channelScopeOf, inScope, channelIdIn, linksInScope } = await import('../channel-scope.js');

const LAB = 'g-lab' as ChannelGroupId;

function reqHolding(assignments: readonly AssignmentGrant[] | null): Request {
  return (assignments === null ? {} : { principal: { userId: 'u1', grants: foldGrants(assignments, new Date()) } }) as unknown as Request;
}

beforeEach(() => { rows.mockReset(); });

describe('channelScopeOf', () => {
  it('is every channel, with no query, for an all-channel grant', async () => {
    expect(await channelScopeOf(reqHolding([{ permissions: ['channels:read'], scope: ALL_CHANNELS }]), 'channels:read')).toBe(ALL_CHANNELS);
    expect(rows).not.toHaveBeenCalled();
  });

  it('is the channels in the grant\'s groups for a scoped grant', async () => {
    rows.mockResolvedValue([{ channelId: 'c1' }, { channelId: 'c2' }]);
    expect(await channelScopeOf(reqHolding([{ permissions: ['channels:read'], scope: [LAB] }]), 'channels:read')).toEqual(['c1', 'c2']);
  });

  it('is no channel for a permission not held, or for no principal', async () => {
    expect(await channelScopeOf(reqHolding([{ permissions: ['channels:read'], scope: ALL_CHANNELS }]), 'messages:read')).toEqual([]);
    expect(await channelScopeOf(reqHolding(null), 'channels:read')).toEqual([]);
    expect(rows).not.toHaveBeenCalled();
  });
});

describe('inScope', () => {
  it('admits every channel, and a channel-less row, for all channels', () => {
    expect(inScope(ALL_CHANNELS, 'c9')).toBe(true);
    expect(inScope(ALL_CHANNELS, null)).toBe(true);
  });

  it('admits only listed channels, and never a channel-less row, when scoped', () => {
    expect(inScope(['c1'], 'c1')).toBe(true);
    expect(inScope(['c1'], 'c2')).toBe(false);
    expect(inScope(['c1'], null)).toBe(false);
  });
});

describe('channelIdIn', () => {
  it('applies no filter for every channel', () => {
    expect(channelIdIn({} as never, ALL_CHANNELS)).toBeUndefined();
  });

  it('matches nothing for an empty scope', () => {
    expect(channelIdIn({} as never, [])).toBeDefined();
  });
});

describe('linksInScope', () => {
  it('keeps every link for every channel', () => {
    expect(linksInScope(['a', 'b'], ALL_CHANNELS)).toEqual({ shown: ['a', 'b'], outsideScopeCount: 0 });
  });

  it('keeps the links in scope and counts the rest', () => {
    expect(linksInScope(['a', 'b', 'c'], ['b'])).toEqual({ shown: ['b'], outsideScopeCount: 2 });
  });
});
