// ===========================================
// SSRF Address Policy
// ===========================================
// Two policies over the same ranges:
// - Scripts (httpFetch) may not reach reserved or private-network addresses.
// - The administrator's connection test may reach private networks, where
//   integration endpoints live, but not reserved ones: loopback (the server
//   itself), link-local (cloud metadata), unspecified, multicast and the like.
// net.BlockList also matches IPv4-mapped IPv6 addresses (e.g.
// ::ffff:169.254.169.254) against the IPv4 rules.
//
// A hostname check alone is not enough: a DNS name can resolve to a blocked
// address. The transport must therefore also check every RESOLVED address and
// connect to the address it checked (see the server's httpFetch bridge).

import * as net from 'node:net';

type Subnets = ReadonlyArray<readonly [string, number]>;

const RESERVED_V4: Subnets = [
  ['0.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['192.0.0.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
// 64:ff9b::/96 (NAT64) embeds an IPv4 address, which may be loopback or metadata.
const RESERVED_V6: Subnets = [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fe80::', 10], ['ff00::', 8]];
const PRIVATE_V4: Subnets = [
  ['10.0.0.0', 8], ['100.64.0.0', 10], ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15],
];
const PRIVATE_V6: Subnets = [['fc00::', 7]];

function blockList(v4: Subnets, v6: Subnets): net.BlockList {
  const list = new net.BlockList();
  for (const [addr, prefix] of v4) list.addSubnet(addr, prefix, 'ipv4');
  for (const [addr, prefix] of v6) list.addSubnet(addr, prefix, 'ipv6');
  return list;
}

const RESERVED = blockList(RESERVED_V4, RESERVED_V6);
const RESERVED_OR_PRIVATE = blockList([...RESERVED_V4, ...PRIVATE_V4], [...RESERVED_V6, ...PRIVATE_V6]);

function inList(list: net.BlockList, address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  return list.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function isLocalhostName(bare: string): boolean {
  return bare === 'localhost' || bare.endsWith('.localhost');
}

/** Scripts: true when an IP address literal is reserved or private. Non-IP input returns false. */
export function isBlockedAddress(address: string): boolean {
  return inList(RESERVED_OR_PRIVATE, address);
}

/**
 * Scripts: true when a URL hostname must be refused before any DNS lookup:
 * localhost names and blocked IP literals. Accepts the bracketed IPv6 form that
 * `URL.hostname` returns (e.g. `[::1]`) and a trailing root dot (e.g. `localhost.`).
 */
export function isBlockedHostname(hostname: string): boolean {
  const bare = bareHost(hostname);
  return isLocalhostName(bare) || isBlockedAddress(bare);
}

/** Connection test: true when an IP address literal is reserved (private networks pass). Non-IP input returns false. */
export function isReservedAddress(address: string): boolean {
  return inList(RESERVED, address);
}

/** Connection test: localhost names and reserved IP literals, in any form `isBlockedHostname` accepts. */
export function isReservedHostname(hostname: string): boolean {
  const bare = bareHost(hostname);
  return isLocalhostName(bare) || isReservedAddress(bare);
}

/** A URL hostname without IPv6 brackets or a trailing root dot, in lower case. */
function bareHost(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '').toLowerCase();
}

/**
 * True when an administrator has named this host as one scripts may reach even
 * though its address is private (`SCRIPT_HTTP_ALLOWED_HOSTS`). The match is on
 * the exact host name or IP literal in the URL, never on what a name resolves to.
 */
export function isAllowedHost(hostname: string, allowed: ReadonlyArray<string> | undefined): boolean {
  if (allowed === undefined || allowed.length === 0) return false;
  const bare = bareHost(hostname);
  return allowed.some((entry) => bareHost(entry.trim()) === bare);
}
