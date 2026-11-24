// A script no time limit stops must cost a restart, not the server (GHSA-4r4j-9c5f-87jh). The
// script runs in a child process, which it would otherwise hang for good.

import { describe, expect, it } from 'vitest';
import { holdReason } from '../script-hold.js';
import { runStuckScript } from './support/run-stuck-script.js';

const TEST_TIMEOUT_MS = 90_000;
const CHANNEL = 'b5a7c1de-0000-4000-8000-00000000000a';
/** Refuses the connection at once. */
const NO_DATABASE = 'postgresql://u:p@127.0.0.1:1/none';

describe('a script that no time limit stops', { timeout: TEST_TIMEOUT_MS }, () => {
  it('ends the process, naming the channel, even when the database cannot be reached', async () => {
    const end = await runStuckScript({ channelId: CHANNEL, connectionString: NO_DATABASE });
    expect(end).toMatchObject({ timedOut: false, exitedCleanly: false });
    expect(end.output).not.toMatch(/^finished/m);
    expect(end.output).toContain('"level":60');
    expect(end.output).toContain(`"channelId":"${CHANNEL}"`);
    expect(end.output).toContain('cannot be stopped');
    expect(end.output).toContain('could not be held');
  });

  it('waits for the limit and the whole grace first', async () => {
    const end = await runStuckScript({ channelId: CHANNEL, connectionString: NO_DATABASE, timeout: 500, graceMs: 2_500 });
    const began = Number(/^began (\d+)/m.exec(end.output)?.[1]);
    const ended = Number(/"time":(\d+).*cannot be stopped/.exec(end.output)?.[1]);
    expect(ended - began).toBeGreaterThanOrEqual(3_000);
  });

  it('ends the process when the script belongs to no channel', async () => {
    const end = await runStuckScript({ channelId: null, connectionString: NO_DATABASE });
    expect(end).toMatchObject({ timedOut: false, exitedCleanly: false });
    expect(end.output).toContain('cannot be stopped');
    expect(end.output).not.toContain('held');
  });

  it('leaves the process alone while a debugger is open', async () => {
    const end = await runStuckScript({ channelId: CHANNEL, connectionString: NO_DATABASE, debugging: true, loopMs: 8_000 });
    expect(end).toMatchObject({ timedOut: false, exitedCleanly: true });
    expect(end.output).toContain('finished loop');
  });
});

describe('a script its time limit stops', { timeout: TEST_TIMEOUT_MS }, () => {
  it('ends on its own, and the process lives on', async () => {
    const end = await runStuckScript({ code: 'for (;;) {}', timeout: 2_000, graceMs: 10_000, channelId: CHANNEL, connectionString: NO_DATABASE });
    expect(end).toMatchObject({ timedOut: false, exitedCleanly: true });
    expect(end.output).toContain('finished Script execution timed out after 2000ms');
    expect(end.output).not.toContain('cannot be stopped');
  });
});

describe('holdReason', () => {
  it('says what happened, when, and what becomes of the message', () => {
    const reason = holdReason(60_000, new Date('2026-11-24T03:00:00Z'));
    expect(reason).toContain('60 s past its time limit at 2026-11-24T03:00:00.000Z');
    expect(reason).toContain('runs again on the next deploy');
  });
});
