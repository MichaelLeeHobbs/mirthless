import { performance } from 'node:perf_hooks';
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, PASSWORD_HASH_COST } from '../password.js';

const PASSWORD = 'Corr3ct-h0rse-batt3ry été';

// Hashes of PASSWORD written by the bcryptjs versions the server used before (#257).
const BCRYPTJS_2_COST_4 = '$2a$04$5yQc8fkR6RHf7esNyZNdw.hSCjScdwZohZA3aV33M6tO06tbPpEp6';
const BCRYPTJS_3_COST_4 = '$2b$04$vQQjQc9Ft/MTleeDRZTc7eHKlFmkUpUbQjI2DigfqXEvSujCrp8Z2';
const BCRYPTJS_3_COST_12 = '$2b$12$XD8OGfzFmzSwvFV//LwxV.ucd9s98PBt0dR8Us.7dxkinh.sFNsFS';

describe('password hashing', () => {
  it('hashes at the configured cost, and the hash verifies only the same password', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).toMatch(new RegExp(`^\\$2b\\$${String(PASSWORD_HASH_COST)}\\$`));
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}!`, hash)).toBe(false);
  });

  it.each([
    ['$2a$ from bcryptjs 2', BCRYPTJS_2_COST_4],
    ['$2b$ from bcryptjs 3', BCRYPTJS_3_COST_4],
    ['$2b$ at cost 12 from bcryptjs 3', BCRYPTJS_3_COST_12],
  ])('verifies a stored %s hash, so no one has to reset a password', async (_label, hash) => {
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('leaves the event loop free while several comparisons run', async () => {
    // Four cost-12 comparisons at once. On libuv's thread pool the event loop
    // only waits, however loaded the machine is.
    let ticks = 0;
    // Coarse, so the ticker's own wake-ups add next to nothing to what is measured.
    const timer = setInterval(() => { ticks += 1; }, 10);
    const before = performance.eventLoopUtilization();
    const results = await Promise.all(Array.from({ length: 4 }, () => verifyPassword(PASSWORD, BCRYPTJS_3_COST_12)));
    const used = performance.eventLoopUtilization(before);
    clearInterval(timer);

    expect(results).toEqual([true, true, true, true]);
    expect(ticks).toBeGreaterThan(0);
    expect(used.utilization).toBeLessThan(0.5);
  });
});
