import { describe, it, expect } from 'vitest';
import type { ChannelAccessView } from '@galvanigraph/core-models';
import { accessCsv, describePath } from '../channel-access.js';

const VIEW: ChannelAccessView = {
  asOf: null,
  people: [{
    userId: 'u1', username: 'priya', permissions: ['messages:read', 'channels:read'],
    through: [
      { role: 'Lab analyst', permissions: ['messages:read', 'channels:read'], groupIds: ['g1', 'g2'], expiresAt: null },
      { role: '=viewer', permissions: ['channels:read'], groupIds: null, expiresAt: '2027-01-01T00:00:00.000Z' },
    ],
  }],
  throughCode: [{ userId: 'u2', username: 'dev' }],
  throughSharedData: [],
};
const groupName = (id: string): string => ({ g1: 'Lab', g2: 'Radiology' })[id] ?? id;
const NOW = '2026-11-17T12:00:00.000Z';

describe('describePath', () => {
  it('names the role, the scope and the end', () => {
    expect(describePath(VIEW.people[0]!.through[0]!, groupName, (t) => t)).toBe('Lab analyst · Lab, Radiology');
    expect(describePath(VIEW.people[0]!.through[1]!, groupName, () => 'Jan 1')).toBe('=viewer · All channels · until Jan 1');
  });
});

describe('accessCsv', () => {
  it('writes a row per person and way in, and the people who reach every channel through code', () => {
    const lines = accessCsv(VIEW, groupName, NOW).trimEnd().split('\r\n');
    expect(lines[0]).toBe('As of,Person,Access,Permissions,Role,Scope,Until');
    expect(lines[1]).toBe(`${NOW},priya,Assignment,Read messages; Read channels,Lab analyst,Lab; Radiology,`);
    // Each way in lists its own permissions, not the person's merged set.
    expect(lines[2]).toBe(`${NOW},priya,Assignment,Read channels,'=viewer,All channels,2027-01-01T00:00:00.000Z`);
    expect(lines[3]).toBe(`${NOW},dev,Channel code (not recorded),,,Every channel,`);
  });

  it('dates every row with the time the view was rebuilt for, when it was', () => {
    const past = { ...VIEW, asOf: '2026-10-01T09:00:00.000Z' };
    const lines = accessCsv(past, groupName, NOW).trimEnd().split('\r\n').slice(1);
    expect(lines.every((l) => l.startsWith('2026-10-01T09:00:00.000Z,'))).toBe(true);
  });

  it('neutralises a field a spreadsheet would read as a formula', () => {
    expect(accessCsv(VIEW, groupName, NOW)).toContain(",'=viewer,");
  });
});
