// ===========================================
// Channel Group Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { setChannelGroupsSchema } from '../channel-group.schema.js';

const G1 = '6f1c2a4e-8b3d-4c7a-9e21-0a5b7c9d1e2f';
const G2 = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';

describe('setChannelGroupsSchema', () => {
  it('accepts a list of group ids', () => {
    expect(setChannelGroupsSchema.safeParse({ groupIds: [G1, G2] }).success).toBe(true);
  });

  it('accepts an empty list, which takes the channel out of every group', () => {
    expect(setChannelGroupsSchema.safeParse({ groupIds: [] }).success).toBe(true);
  });

  it('rejects a missing groupIds', () => {
    expect(setChannelGroupsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an id that is not a uuid', () => {
    expect(setChannelGroupsSchema.safeParse({ groupIds: ['not-a-uuid'] }).success).toBe(false);
  });

  it('rejects the same group twice', () => {
    const result = setChannelGroupsSchema.safeParse({ groupIds: [G1, G1] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('must not repeat');
  });
});
