import { describe, it, expect } from 'vitest';
import { purgeDeletedChannelSchema } from '../audit.schema.js';

describe('purgeDeletedChannelSchema', () => {
  it('takes a reason of one line, without its surrounding spaces', () => {
    expect(purgeDeletedChannelSchema.parse({ reason: '  moved to the new engine ' })).toEqual({ reason: 'moved to the new engine' });
    expect(purgeDeletedChannelSchema.safeParse({ reason: 'abc' }).success).toBe(true);
    expect(purgeDeletedChannelSchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(true);
  });

  it.each([[{}], [{ reason: '' }], [{ reason: ' ab ' }], [{ reason: 'one\nline' }], [{ reason: 'x'.repeat(501) }]])('refuses %j', (body) => {
    expect(purgeDeletedChannelSchema.safeParse(body).success).toBe(false);
  });

  it('says what is missing', () => {
    expect(purgeDeletedChannelSchema.safeParse({ reason: 'ab' }).error?.issues[0]?.message).toBe('Say why you are removing the messages (at least 3 characters).');
  });
});
