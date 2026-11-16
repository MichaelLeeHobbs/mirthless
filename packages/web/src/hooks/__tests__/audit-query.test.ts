import { describe, it, expect } from 'vitest';
import { buildAuditQueryString } from '../use-audit.js';

describe('buildAuditQueryString', () => {
  it('sends only the filters that are set', () => {
    expect(buildAuditQueryString({ page: 2, pageSize: 25, action: 'USER_LOGIN' })).toBe('?page=2&pageSize=25&action=USER_LOGIN');
  });

  it('is empty when nothing is set', () => {
    expect(buildAuditQueryString({})).toBe('');
  });
});
