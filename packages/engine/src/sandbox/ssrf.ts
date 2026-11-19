// Two policies over the same ranges: scripts (httpFetch) may not reach reserved or private
// addresses; Test Connection may reach private networks, where integration endpoints live, but
// not reserved ones (loopback, link-local cloud metadata, unspecified, multicast and the like).
// net.BlockList also matches IPv4-mapped IPv6 addresses against the IPv4 rules.
//
// A hostname check alone is not enough: a DNS name can resolve to a blocked address, so the
// transport must also check every resolved address and connect to the one it checked (the
// server's httpFetch bridge).

import * as net from 'node:net';

type Subnets = ReadonlyArray<readonly [string, number]>;

// Cloud metadata endpoints that sit inside private ranges are reserved too:
// Alibaba's 100.100.100.200, and AWS's IPv6 IMDS and EKS pod identity in fd00:ec2::/32.
const RESERVED_V4: Subnets = [
  ['0.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['192.0.0.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ['100.100.100.200', 32],
];
// 64:ff9b::/96 (NAT64) embeds an IPv4 address, which may be loopback or metadata.
const RESERVED_V6: Subnets = [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fe80::', 10], ['ff00::', 8], ['fd00:ec2::254', 128], ['fd00:ec2::23', 128],
];
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

/** The script policy. Non-IP input returns false. */
export function isBlockedAddress(address: string): boolean {
  return inList(RESERVED_OR_PRIVATE, address);
}

/**
 * The script policy, checked before any DNS lookup. Accepts `URL.hostname`'s bracketed IPv6
 * form (`[::1]`) and a trailing root dot (`localhost.`).
 */
export function isBlockedHostname(hostname: string): boolean {
  const bare = bareHost(hostname);
  return isLocalhostName(bare) || isBlockedAddress(bare);
}

/** The Test Connection policy: private networks pass. Non-IP input returns false. */
export function isReservedAddress(address: string): boolean {
  return inList(RESERVED, address);
}

/** The Test Connection policy, for any form `isBlockedHostname` accepts. */
export function isReservedHostname(hostname: string): boolean {
  const bare = bareHost(hostname);
  return isLocalhostName(bare) || isReservedAddress(bare);
}

function bareHost(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '').toLowerCase();
}

/**
 * Hosts an administrator lets scripts reach although private (`SCRIPT_HTTP_ALLOWED_HOSTS`).
 * Matches the exact host name or IP literal, never what a name resolves to.
 */
export function isAllowedHost(hostname: string, allowed: ReadonlyArray<string> | undefined): boolean {
  if (allowed === undefined || allowed.length === 0) return false;
  const bare = bareHost(hostname);
  return allowed.some((entry) => bareHost(entry.trim()) === bare);
}
