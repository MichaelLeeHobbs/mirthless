import { describe, it, expect } from 'vitest';
import { humanize } from '../format.js';

describe('humanize', () => {
  it('turns an upper snake case enum into sentence case', () => {
    expect(humanize('CHANNEL_ERROR')).toBe('Channel error');
  });

  it('handles kebab case, repeated separators and padding', () => {
    expect(humanize('  user--login__failed ')).toBe('User login failed');
  });

  it('capitalises a single lower case word', () => {
    expect(humanize('admin')).toBe('Admin');
  });

  it('returns an empty string for empty input', () => {
    expect(humanize('')).toBe('');
  });
});
