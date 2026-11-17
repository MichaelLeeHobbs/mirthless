import { describe, expect, it } from 'vitest';
import { hashToken, matchesTokenHash } from '../token-hash.js';

describe('hashToken', () => {
  it('is the hex SHA-256 of the token', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('matchesTokenHash', () => {
  it('accepts the token whose hash is stored', () => {
    expect(matchesTokenHash('secret', hashToken('secret'))).toBe(true);
  });

  it('refuses another token, an empty one, and a stored value that is not a hash', () => {
    expect(matchesTokenHash('other', hashToken('secret'))).toBe(false);
    expect(matchesTokenHash('', hashToken('secret'))).toBe(false);
    expect(matchesTokenHash('secret', 'not-hex')).toBe(false);
    expect(matchesTokenHash('secret', '')).toBe(false);
  });
});
