// ===========================================
// SSRF Address Policy
// ===========================================
// Decides whether an outbound script request (httpFetch) may reach an address.
// Loopback, private, link-local (cloud metadata), CGNAT, multicast and other
// reserved ranges are blocked. net.BlockList also matches IPv4-mapped IPv6
// addresses (e.g. ::ffff:169.254.169.254) against the IPv4 rules.
//
// A hostname check alone is not enough: a DNS name can resolve to a private
// address. The transport must therefore also check every RESOLVED address and
// connect to the address it checked (see the server's httpFetch bridge).

import * as net from 'node:net';

const BLOCKED: net.BlockList = ((): net.BlockList => {
  const list = new net.BlockList();
  const v4: ReadonlyArray<readonly [string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  const v6: ReadonlyArray<readonly [string, number]> = [
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ];
  for (const [addr, prefix] of v4) list.addSubnet(addr, prefix, 'ipv4');
  for (const [addr, prefix] of v6) list.addSubnet(addr, prefix, 'ipv6');
  return list;
})();

/** True when an IP address literal is in a blocked range. Non-IP input returns false. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * True when a URL hostname must be refused before any DNS lookup: localhost names
 * and blocked IP literals. Accepts the bracketed IPv6 form that `URL.hostname`
 * returns (e.g. `[::1]`) and a trailing root dot (e.g. `localhost.`).
 */
export function isBlockedHostname(hostname: string): boolean {
  const bare = hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '').toLowerCase();
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  return isBlockedAddress(bare);
}
