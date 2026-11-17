import { describe, it, expect } from 'vitest';
import { accessChange } from '../RoleAccessSection.js';
import type { RoleSummary } from '../../../api/client.js';

function role(permissions: readonly string[]): RoleSummary {
  return { id: 'r', name: 'r', description: '', builtIn: false, admin: false, permissions, holders: 0, createdAt: '', updatedAt: '' };
}

describe('accessChange', () => {
  it('names what a role change gives and takes, by label', () => {
    expect(accessChange([role(['channels:read', 'messages:read'])], role(['channels:read', 'channels:deploy']))).toEqual({
      gains: ['Deploy channels'], losses: ['Read messages'],
    });
  });

  it('shows everything as a gain for a user with no role yet', () => {
    expect(accessChange([], role(['channels:read'])).gains).toEqual(['Read channels']);
  });

  it('shows nothing for the same role', () => {
    expect(accessChange([role(['channels:read'])], role(['channels:read']))).toEqual({ gains: [], losses: [] });
  });

  it('counts every role a user holds as lost, since the save replaces them all', () => {
    expect(accessChange([role(['channels:read']), role(['messages:read'])], role(['channels:read']))).toEqual({
      gains: [], losses: ['Read messages'],
    });
  });
});
