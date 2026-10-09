// ===========================================
// SSRF Address Policy Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { isBlockedAddress, isBlockedHostname } from '../ssrf.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fc00::1', 'fe80::1',
    '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:127.0.0.1', '64:ff9b::a9fe:a9fe',
  ])('blocks %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(false);
  });

  it('returns false for non-IP input', () => {
    expect(isBlockedAddress('example.com')).toBe(false);
  });
});

describe('isBlockedHostname', () => {
  it.each(['localhost', 'LOCALHOST', 'localhost.', 'api.localhost', '[::1]', '[::ffff:a9fe:a9fe]', '[fd00::1]', '127.0.0.1'])(
    'blocks %s', (host) => {
      expect(isBlockedHostname(host)).toBe(true);
    },
  );

  it('blocks the hostnames URL produces for obfuscated loopback forms', () => {
    expect(isBlockedHostname(new URL('http://0x7f.1/').hostname)).toBe(true);
    expect(isBlockedHostname(new URL('http://2130706433/').hostname)).toBe(true);
  });

  it.each(['example.com', '[2606:4700:4700::1111]', '8.8.8.8'])('allows %s', (host) => {
    expect(isBlockedHostname(host)).toBe(false);
  });
});
