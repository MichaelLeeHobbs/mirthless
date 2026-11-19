import { describe, it, expect } from 'vitest';
import { errorMessage } from '../error-message.js';

const FALLBACK = 'fallback text';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'), FALLBACK)).toBe('boom');
  });

  it('returns a non-empty string as-is', () => {
    expect(errorMessage('nope', FALLBACK)).toBe('nope');
  });

  it('returns the fallback for an Error with an empty message', () => {
    expect(errorMessage(new Error(''), FALLBACK)).toBe(FALLBACK);
  });

  it('returns the fallback for an empty string', () => {
    expect(errorMessage('', FALLBACK)).toBe(FALLBACK);
  });

  it('returns the fallback for values that are neither Error nor string', () => {
    expect(errorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage({ message: 'not an Error' }, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(42, FALLBACK)).toBe(FALLBACK);
  });
});
