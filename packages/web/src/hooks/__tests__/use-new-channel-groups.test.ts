import { describe, it, expect } from 'vitest';
import { writeGroupChoices } from '../use-new-channel-groups.js';

describe('writeGroupChoices', () => {
  it('asks nothing of someone who holds channels:write on every channel, or not at all', () => {
    expect(writeGroupChoices([{ permission: 'channels:write', scope: 'all' }])).toBeNull();
    expect(writeGroupChoices([{ permission: 'channels:read', scope: ['g1', 'g2'] }])).toBeNull();
    expect(writeGroupChoices(undefined)).toBeNull();
  });

  it('asks nothing of someone who holds it on one group: the server uses that group', () => {
    expect(writeGroupChoices([{ permission: 'channels:write', scope: ['g1'] }])).toBeNull();
  });

  it('offers the groups of someone who holds it on several', () => {
    expect(writeGroupChoices([{ permission: 'channels:write', scope: ['g1', 'g2'] }])).toEqual(['g1', 'g2']);
  });
});
