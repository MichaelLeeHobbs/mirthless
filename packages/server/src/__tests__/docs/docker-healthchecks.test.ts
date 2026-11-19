// Inside a container `localhost` can resolve to ::1 first (it does in the nginx alpine image),
// and nginx's `listen 80;` binds IPv4 only, so a check on localhost was refused every run (#306).
// nginx does not also listen on [::]: that line stops it starting on a host with IPv6 turned off.

import { describe, it, expect } from 'vitest';
import { readRepoFile } from '../../../test/markdown.js';

const COMPOSE = 'docker/docker-compose.prod.yml';

function healthCheckUrls(text: string): readonly string[] {
  const urls: string[] = [];
  for (const line of text.split('\n')) {
    if (!/^\s*test:/.test(line)) continue;
    for (const match of line.matchAll(/https?:\/\/[^\s"']+/g)) urls.push(match[0]);
  }
  return urls;
}

describe('docker-compose.prod.yml health checks', () => {
  const urls = healthCheckUrls(readRepoFile(COMPOSE));

  it('has HTTP health checks to guard', () => {
    // The server and web services; a rewrite that drops them should fail here, not pass silently.
    expect(urls.length).toBeGreaterThanOrEqual(2);
  });

  it('reaches each service over the IPv4 loopback, not localhost', () => {
    const viaLocalhost = urls.filter((url) => new URL(url).hostname !== '127.0.0.1');
    expect(viaLocalhost, 'use http://127.0.0.1 in the check (#306)').toEqual([]);
  });
});
