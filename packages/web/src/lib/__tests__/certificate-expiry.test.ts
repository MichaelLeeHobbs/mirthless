import { describe, it, expect } from 'vitest';
import { expiryColor, expiryDays, expiryLabel } from '../certificate-expiry.js';

const NOW = Date.parse('2026-11-13T12:00:00Z');

describe('expiryDays', () => {
  it('counts whole days left', () => {
    expect(expiryDays('2026-12-13T12:00:00Z', NOW)).toBe(30);
    expect(expiryDays('2026-11-14T11:00:00Z', NOW)).toBe(0);
  });

  it('goes negative once expired', () => {
    expect(expiryDays('2026-11-10T12:00:00Z', NOW)).toBe(-3);
  });
});

describe('expiryColor', () => {
  it('is error under 30 days, warning under 90, success after', () => {
    expect(expiryColor(-1)).toBe('error');
    expect(expiryColor(29)).toBe('error');
    expect(expiryColor(30)).toBe('warning');
    expect(expiryColor(89)).toBe('warning');
    expect(expiryColor(90)).toBe('success');
  });
});

describe('expiryLabel', () => {
  it('says how long is left or how long ago it expired', () => {
    expect(expiryLabel(12)).toBe('12d remaining');
    expect(expiryLabel(0)).toBe('0d remaining');
    expect(expiryLabel(-3)).toBe('Expired 3d ago');
  });
});
