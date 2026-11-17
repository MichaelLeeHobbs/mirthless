import { describe, it, expect } from 'vitest';
import { roleFlags, ROLE_FLAG } from '../role-flags.js';
import { roleFlagLevel } from '../status.js';

describe('roleFlags', () => {
  it('flags a role that can change who holds what as strong as admin', () => {
    expect(roleFlags(['users:read', 'users:write'])).toContain(ROLE_FLAG.ADMIN_EQUIVALENT);
  });

  it('flags code, PHI and all-channel-only permissions once each, most serious first', () => {
    expect(roleFlags(['channels:write', 'channels:deploy', 'messages:read', 'global_map:read'])).toEqual([
      ROLE_FLAG.RUNS_CODE, ROLE_FLAG.READS_PHI, ROLE_FLAG.ALL_CHANNELS_ONLY,
    ]);
  });

  it('gives a read-only channel role no flags', () => {
    expect(roleFlags(['channels:read', 'code_templates:read'])).toEqual([]);
  });

  it('flags the admin role as strong as admin whatever its list says', () => {
    expect(roleFlags([], { admin: true })).toEqual([ROLE_FLAG.ADMIN_EQUIVALENT]);
  });
});

describe('roleFlagLevel', () => {
  it('reads as admin critical, code and PHI a warning, all-channel-only information', () => {
    expect(roleFlagLevel(ROLE_FLAG.ADMIN_EQUIVALENT)).toBe('critical');
    expect(roleFlagLevel(ROLE_FLAG.RUNS_CODE)).toBe('warning');
    expect(roleFlagLevel(ROLE_FLAG.READS_PHI)).toBe('warning');
    expect(roleFlagLevel(ROLE_FLAG.ALL_CHANNELS_ONLY)).toBe('info');
  });
});
