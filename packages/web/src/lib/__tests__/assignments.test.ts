import { describe, it, expect } from 'vitest';
import type { AssignmentView } from '@galvanigraph/core-models';
import { groupScopeBlocked, sameAssignments, toDraft, toInput, toSend } from '../assignments.js';
import { toDateTimeLocal } from '../datetime-local.js';

const VIEW: AssignmentView = {
  id: 'a-1', roleId: 'r-1', roleName: 'channel-viewer', groupIds: ['g-1'],
  expiresAt: null, reason: 'on call', live: true, createdAt: '2026-11-01T00:00:00.000Z',
};

describe('assignment drafts', () => {
  it('round-trips a permanent scoped assignment', () => {
    expect(toInput(toDraft(VIEW))).toEqual({ roleId: 'r-1', groupIds: ['g-1'], expiresAt: null, reason: 'on call' });
  });

  it('sends an untouched expiry back as the same instant', () => {
    const iso = '2027-01-02T03:04:05.678Z';
    expect(toInput(toDraft({ ...VIEW, expiresAt: iso })).expiresAt).toBe(iso);
  });

  it('sends a blank reason or expiry as none', () => {
    const draft = { ...toDraft(VIEW), reason: '   ', expiresAt: '' };
    expect(toInput(draft)).toMatchObject({ reason: null, expiresAt: null });
  });

  it('drops an expired row nobody renewed from what a save sends, and keeps a renewed one', () => {
    const expired = toDraft({ ...VIEW, id: 'a-2', expiresAt: '2020-01-01T00:00:00.000Z', live: false });
    expect(expired.expired).toBe(true);
    expect(toSend([toDraft(VIEW), expired])).toEqual([toInput(toDraft(VIEW))]);
    const renewed = { ...expired, expiresAt: toDateTimeLocal('2030-01-01T00:00:00.000Z'), expired: false };
    expect(toSend([renewed]).map((a) => a.expiresAt)).toEqual(['2030-01-01T00:00:00.000Z']);
  });

  it('sends a changed or cleared end time, not the stored one', () => {
    const draft = toDraft({ ...VIEW, expiresAt: '2027-01-02T03:04:05.678Z' });
    const shortened = { ...draft, expiresAt: toDateTimeLocal('2026-12-01T00:00:00.000Z') };
    expect(toInput(shortened).expiresAt).toBe('2026-12-01T00:00:00.000Z');
    expect(toInput({ ...draft, expiresAt: '' }).expiresAt).toBeNull();
    expect(sameAssignments([draft], [shortened])).toBe(false);
  });

  it('sends a time it cannot read as typed, for the server to refuse, and never as no end', () => {
    expect(toInput({ ...toDraft(VIEW), expiresAt: '20266-11-23T10:20' }).expiresAt).toBe('20266-11-23T10:20');
  });

  it('compares lists by what they would send, not by row keys', () => {
    const a = [toDraft(VIEW)];
    expect(sameAssignments(a, [{ ...a[0]!, key: 'other' }])).toBe(true);
    expect(sameAssignments(a, [{ ...a[0]!, groupIds: null }])).toBe(false);
    expect(sameAssignments(a, [])).toBe(false);
  });
});

describe('groupScopeBlocked', () => {
  it('blocks a role holding a permission limited to every channel', () => {
    expect(groupScopeBlocked(['channels:read', 'settings:write'])).not.toBeNull();
  });

  it('allows a role of channel permissions, and ignores names it does not know', () => {
    expect(groupScopeBlocked(['channels:read', 'messages:read', 'not:a-permission'])).toBeNull();
  });
});
