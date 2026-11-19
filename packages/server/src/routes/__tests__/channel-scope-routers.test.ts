// A /channels router with a :id route that skips scopeToChannel(router) lets a
// caller holding the permission on one group reach every channel (D-310).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Router } from 'express';

interface RouteLayer { readonly route?: { readonly path: string } }

describe('channel routers', () => {
  it('each router mounted at /channels with a :id route reads the channel\'s scope', async () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const files = new Map([...source.matchAll(/import (\w+) from '\.\/([\w-]+\.routes)\.js'/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
    const atChannels = [...source.matchAll(/router\.use\('\/channels',\s*(\w+)\)/g)].map((m) => m[1] ?? '');
    expect(atChannels.length).toBeGreaterThan(0);

    const unscoped: string[] = [];
    for (const name of atChannels) {
      const file = files.get(name) ?? name;
      const router = ((await import(`../${file}.ts`)) as { default: Router & { params: Record<string, unknown> } }).default;
      const namesAChannel = (router.stack as unknown as readonly RouteLayer[]).some((l) => l.route?.path.includes(':id') === true);
      if (namesAChannel && router.params['id'] === undefined) unscoped.push(file);
    }
    expect(unscoped).toEqual([]);
  });
});
