// ===========================================
// Repo guard: health checks in docker/docker-compose.prod.yml
// ===========================================
// A health check runs inside its container, where `localhost` can resolve to
// ::1 before 127.0.0.1 (it does in the nginx alpine image). nginx's `listen 80;`
// binds IPv4 only, so a check on http://localhost was refused on every run and
// the web container stayed unhealthy while it served traffic (#306). Checks
// name 127.0.0.1 instead. nginx does not also listen on [::] because that line
// stops it from starting on a host with IPv6 turned off.

import { describe, it, expect } from 'vitest';
import { readRepoFile } from '../../../test/markdown.js';

const COMPOSE = 'docker/docker-compose.prod.yml';

/** The URLs that `test:` lines in the file fetch, comments skipped. */
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
