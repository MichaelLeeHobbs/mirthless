// Docker kills a container that has not ended when its grace period is over (10 s by
// default), and the server takes longer than that to let what it is doing end (#419).

import { describe, it, expect } from 'vitest';
import { DRAIN_TIMEOUT_MS } from '../../lib/shutdown.js';
import { readRepoFile } from '../../../test/markdown.js';

const COMPOSE = 'docker/docker-compose.prod.yml';

/** A service's lines, without those of the services after it. */
function serviceBlock(text: string, service: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(`  ${service}:`);
  const length = lines.slice(start + 1).findIndex((line) => /^ {0,2}\S/.test(line));
  return start === -1 ? '' : lines.slice(start, start + 1 + length).join('\n');
}

describe('docker-compose.prod.yml', () => {
  it('gives the server longer to stop than its own shutdown takes at most', () => {
    const grace = /^ {4}stop_grace_period: (\d+)s$/m.exec(serviceBlock(readRepoFile(COMPOSE), 'server'));

    expect(grace, 'the server service sets stop_grace_period in seconds').not.toBeNull();
    expect(Number(grace?.[1]) * 1000).toBeGreaterThan(DRAIN_TIMEOUT_MS);
  });
});
