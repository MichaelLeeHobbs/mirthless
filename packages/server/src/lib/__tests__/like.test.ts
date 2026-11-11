// ===========================================
// LIKE pattern escaping tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { containsPattern } from '../like.js';

describe('containsPattern', () => {
  it('wraps plain text in wildcards', () => {
    expect(containsPattern('SMITH')).toBe('%SMITH%');
  });

  it('escapes the wildcards and the escape character in the text', () => {
    expect(containsPattern('100%')).toBe('%100\\%%');
    expect(containsPattern('A_B')).toBe('%A\\_B%');
    expect(containsPattern('C:\\dir')).toBe('%C:\\\\dir%');
  });
});
