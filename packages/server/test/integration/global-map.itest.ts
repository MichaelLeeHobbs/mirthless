// ===========================================
// Global Map Service — real Postgres integration
// ===========================================
// Checks the is_json column round trip that the engine relies on to give a
// script back the same type it stored.

import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { describeIntegration, unwrap } from './_setup.js';

describeIntegration('GlobalMapService (real Postgres)', () => {
  let GlobalMapService: typeof import('../../src/services/global-map.service.js').GlobalMapService;
  let pool: typeof import('../../src/lib/db.js').pool;
  const keys = ['itest.count', 'itest.zip'];

  beforeAll(async () => {
    ({ GlobalMapService } = await import('../../src/services/global-map.service.js'));
    ({ pool } = await import('../../src/lib/db.js'));
  });

  afterEach(async () => {
    for (const key of keys) unwrap(await GlobalMapService.persistRemoval(key));
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function read(key: string): Promise<{ value: string | null; isJson: boolean }> {
    const entry = unwrap(await GlobalMapService.getByKey(key));
    return { value: entry.value, isJson: entry.isJson };
  }

  it('keeps the JSON flag an engine write stores, and updates it in place', async () => {
    unwrap(await GlobalMapService.persist('itest.count', '7', true));
    unwrap(await GlobalMapService.persist('itest.zip', '00501', false));
    expect(await read('itest.count')).toEqual({ value: '7', isJson: true });
    expect(await read('itest.zip')).toEqual({ value: '00501', isJson: false });

    unwrap(await GlobalMapService.persist('itest.count', '8', true));
    expect(await read('itest.count')).toEqual({ value: '8', isJson: true });

    const listed = unwrap(await GlobalMapService.list()).filter((e) => keys.includes(e.key));
    expect(listed.map((e) => [e.key, e.isJson])).toEqual([['itest.count', true], ['itest.zip', false]]);
  });

  it('an edit through the API turns a JSON entry back into plain text', async () => {
    unwrap(await GlobalMapService.persist('itest.count', '7', true));
    unwrap(await GlobalMapService.upsert('itest.count', '9'));
    expect(await read('itest.count')).toEqual({ value: '9', isJson: false });
  });

  it('removing a key that is not there succeeds', async () => {
    unwrap(await GlobalMapService.persistRemoval('itest.count'));
    expect((await GlobalMapService.getByKey('itest.count')).ok).toBe(false);
  });
});
