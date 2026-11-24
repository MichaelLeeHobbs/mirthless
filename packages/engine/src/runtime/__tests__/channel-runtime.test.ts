import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import { ChannelRuntime } from '../channel-runtime.js';
import type { RuntimeSourceConnector, RuntimeConnector, ChannelRuntimeConfig } from '../channel-runtime.js';

function ok(): Result<void> {
  return { ok: true, value: undefined, error: null } as Result<void>;
}

function makeConnector(): RuntimeConnector {
  return {
    onDeploy: vi.fn().mockResolvedValue(ok()),
    onStart: vi.fn().mockResolvedValue(ok()),
    onStop: vi.fn().mockResolvedValue(ok()),
    onHalt: vi.fn().mockResolvedValue(ok()),
    onUndeploy: vi.fn().mockResolvedValue(ok()),
  };
}

function makeSource(): RuntimeSourceConnector {
  return {
    ...makeConnector(),
    setDispatcher: vi.fn(),
  };
}

function makeConfig(overrides?: Partial<ChannelRuntimeConfig>): ChannelRuntimeConfig {
  return {
    channelId: '00000000-0000-0000-0000-000000000001',
    source: makeSource(),
    destinations: new Map([[1, makeConnector()]]),
    onMessage: vi.fn().mockResolvedValue(ok()),
    ...overrides,
  };
}

function deferred(): { readonly promise: Promise<Result<void>>; readonly finish: () => void } {
  let finish = (): void => undefined;
  const promise = new Promise<Result<void>>((resolve) => { finish = () => { resolve(ok()); }; });
  return { promise, finish };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => { setImmediate(resolve); });
}

let runtime: ChannelRuntime;

beforeEach(() => {
  runtime = new ChannelRuntime();
});

describe('ChannelRuntime', () => {
  describe('state transitions', () => {
    it('starts as UNDEPLOYED', () => {
      expect(runtime.getState()).toBe('UNDEPLOYED');
    });

    it('deploy transitions to STOPPED', async () => {
      const result = await runtime.deploy(makeConfig());

      expect(result.ok).toBe(true);
      expect(runtime.getState()).toBe('STOPPED');
    });

    it('start transitions to STARTED', async () => {
      await runtime.deploy(makeConfig());

      const result = await runtime.start();

      expect(result.ok).toBe(true);
      expect(runtime.getState()).toBe('STARTED');
    });

    it('stop transitions to STOPPED', async () => {
      await runtime.deploy(makeConfig());
      await runtime.start();

      const result = await runtime.stop();

      expect(result.ok).toBe(true);
      expect(runtime.getState()).toBe('STOPPED');
    });

    it('undeploy transitions to UNDEPLOYED', async () => {
      await runtime.deploy(makeConfig());

      const result = await runtime.undeploy();

      expect(result.ok).toBe(true);
      expect(runtime.getState()).toBe('UNDEPLOYED');
    });

    it('full lifecycle: deploy → start → stop → undeploy', async () => {
      const config = makeConfig();

      await runtime.deploy(config);
      expect(runtime.getState()).toBe('STOPPED');

      await runtime.start();
      expect(runtime.getState()).toBe('STARTED');

      await runtime.stop();
      expect(runtime.getState()).toBe('STOPPED');

      await runtime.undeploy();
      expect(runtime.getState()).toBe('UNDEPLOYED');
    });
  });

  describe('invalid transitions', () => {
    it('cannot start before deploy', async () => {
      const result = await runtime.start();

      expect(result.ok).toBe(false);
      expect(runtime.getState()).toBe('UNDEPLOYED');
    });

    it('cannot stop before start', async () => {
      await runtime.deploy(makeConfig());

      const result = await runtime.stop();

      expect(result.ok).toBe(false);
      expect(runtime.getState()).toBe('STOPPED');
    });

    it('cannot undeploy while started', async () => {
      await runtime.deploy(makeConfig());
      await runtime.start();

      const result = await runtime.undeploy();

      expect(result.ok).toBe(false);
      expect(runtime.getState()).toBe('STARTED');
    });

    it('cannot deploy twice', async () => {
      await runtime.deploy(makeConfig());

      const result = await runtime.deploy(makeConfig());

      expect(result.ok).toBe(false);
    });
  });

  describe('connector lifecycle order', () => {
    it('deploys source before destinations', async () => {
      const callOrder: string[] = [];
      const source = makeSource();
      const dest = makeConnector();
      (source.onDeploy as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('source.deploy');
        return ok();
      });
      (dest.onDeploy as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('dest.deploy');
        return ok();
      });
      const config = makeConfig({ source, destinations: new Map([[1, dest]]) });

      await runtime.deploy(config);

      expect(callOrder).toEqual(['source.deploy', 'dest.deploy']);
    });

    it('starts destinations before source', async () => {
      const callOrder: string[] = [];
      const source = makeSource();
      const dest = makeConnector();
      (source.onStart as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('source.start');
        return ok();
      });
      (dest.onStart as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('dest.start');
        return ok();
      });
      const config = makeConfig({ source, destinations: new Map([[1, dest]]) });

      await runtime.deploy(config);
      await runtime.start();

      expect(callOrder).toEqual(['dest.start', 'source.start']);
    });

    it('stops source before destinations', async () => {
      const callOrder: string[] = [];
      const source = makeSource();
      const dest = makeConnector();
      (source.onStop as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('source.stop');
        return ok();
      });
      (dest.onStop as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('dest.stop');
        return ok();
      });
      const config = makeConfig({ source, destinations: new Map([[1, dest]]) });

      await runtime.deploy(config);
      await runtime.start();
      await runtime.stop();

      expect(callOrder).toEqual(['source.stop', 'dest.stop']);
    });
  });

  describe('halt', () => {
    it('transitions from STARTED to STOPPED', async () => {
      await runtime.deploy(makeConfig());
      await runtime.start();

      const result = await runtime.halt();

      expect(result.ok).toBe(true);
      expect(runtime.getState()).toBe('STOPPED');
    });

    it('calls onHalt on all connectors', async () => {
      const source = makeSource();
      const dest = makeConnector();
      const config = makeConfig({ source, destinations: new Map([[1, dest]]) });

      await runtime.deploy(config);
      await runtime.start();
      await runtime.halt();

      expect(source.onHalt).toHaveBeenCalledOnce();
      expect(dest.onHalt).toHaveBeenCalledOnce();
    });

    it('aborts the signal work in progress was given, and issues a fresh one', async () => {
      await runtime.deploy(makeConfig());
      await runtime.start();
      const inFlight = runtime.haltSignal;

      await runtime.halt();

      expect(inFlight.aborted).toBe(true);
      expect(runtime.haltSignal.aborted).toBe(false);
    });

    it('overtakes a stop, which then leaves the channel alone', async () => {
      const source = makeSource();
      const dest = makeConnector();
      const hung = deferred();
      (source.onStop as Mock).mockReturnValueOnce(hung.promise);
      await runtime.deploy(makeConfig({ source, destinations: new Map([[1, dest]]) }));
      await runtime.start();

      const stopped = runtime.stop();
      expect((await runtime.halt()).ok).toBe(true);
      expect((await runtime.start()).ok).toBe(true);
      hung.finish();

      expect((await stopped).error?.message).toBe('Cannot stop: the channel was halted');
      expect(runtime.getState()).toBe('STARTED');
      // The destinations were started again, so a stop of them now would take the running channel's.
      expect(dest.onStop).not.toHaveBeenCalled();
    });

    it('a stop it overtook ends only once the halt has', async () => {
      const source = makeSource();
      const dest = makeConnector();
      const hung = deferred();
      const halting = deferred();
      (source.onStop as Mock).mockReturnValueOnce(hung.promise);
      (dest.onHalt as Mock).mockReturnValueOnce(halting.promise);
      await runtime.deploy(makeConfig({ source, destinations: new Map([[1, dest]]) }));
      await runtime.start();

      const states: string[] = [];
      const stopped = runtime.stop().then(() => { states.push(runtime.getState()); });
      const halted = runtime.halt();
      hung.finish();
      await settle();
      expect(states).toEqual([]);
      halting.finish();
      await Promise.all([stopped, halted]);

      expect(states).toEqual(['STOPPED']);
    });

    it('is joined by a stop and by a second halt', async () => {
      const source = makeSource();
      const dest = makeConnector();
      const halting = deferred();
      (dest.onHalt as Mock).mockReturnValueOnce(halting.promise);
      await runtime.deploy(makeConfig({ source, destinations: new Map([[1, dest]]) }));
      await runtime.start();

      const all = Promise.all([runtime.halt(), runtime.halt(), runtime.stop()]);
      await settle();
      halting.finish();

      expect((await all).map((result) => result.ok)).toEqual([true, true, true]);
      expect(source.onHalt).toHaveBeenCalledOnce();
      expect(source.onStop).not.toHaveBeenCalled();
      expect(runtime.getState()).toBe('STOPPED');
    });

    it.each([
      ['pause', 'PAUSED'],
      ['resume', 'STARTED'],
    ] as const)('overtakes a %s, which does not report the channel %s afterwards', async (action, _state) => {
      const source = makeSource();
      const hung = deferred();
      await runtime.deploy(makeConfig({ source }));
      await runtime.start();
      if (action === 'resume') await runtime.pause();
      (action === 'pause' ? source.onStop as Mock : source.onStart as Mock).mockReturnValueOnce(hung.promise);

      const acting = runtime[action]();
      expect((await runtime.halt()).ok).toBe(true);
      hung.finish();

      expect((await acting).error?.message).toBe(`Cannot ${action}: the channel is stopping`);
      expect(runtime.getState()).toBe('STOPPED');
    });

    it('a resume it overtook stops the source that had started by then', async () => {
      const source = makeSource();
      const hung = deferred();
      await runtime.deploy(makeConfig({ source }));
      await runtime.start();
      await runtime.pause();
      (source.onStart as Mock).mockReturnValueOnce(hung.promise);
      const resumed = runtime.resume();
      await runtime.halt();
      (source.onStop as Mock).mockClear();

      hung.finish();
      await resumed;

      expect(source.onStop).toHaveBeenCalledOnce();
    });

    it('a resume it overtook leaves the source of a later start alone', async () => {
      const source = makeSource();
      const hung = deferred();
      await runtime.deploy(makeConfig({ source }));
      await runtime.start();
      await runtime.pause();
      (source.onStart as Mock).mockReturnValueOnce(hung.promise);
      const resumed = runtime.resume();
      await runtime.halt();
      await runtime.start();
      (source.onStop as Mock).mockClear();

      hung.finish();
      await resumed;

      expect(source.onStop).not.toHaveBeenCalled();
      expect(runtime.getState()).toBe('STARTED');
    });

    it('cannot halt when stopped', async () => {
      await runtime.deploy(makeConfig());

      const result = await runtime.halt();

      expect(result.ok).toBe(false);
    });
  });

  describe('stop', () => {
    it.each(['stop', 'halt'] as const)('a %s works again after the next start', async (action) => {
      const source = makeSource();
      await runtime.deploy(makeConfig({ source }));
      for (const times of [1, 2]) {
        await runtime.start();
        expect((await runtime[action]()).ok).toBe(true);
        expect(runtime.getState()).toBe('STOPPED');
        expect(action === 'stop' ? source.onStop : source.onHalt).toHaveBeenCalledTimes(times);
      }
    });

    it('is joined by a second stop, so neither stops what a start after them started', async () => {
      const source = makeSource();
      const dest = makeConnector();
      const hung = deferred();
      (source.onStop as Mock).mockReturnValueOnce(hung.promise);
      await runtime.deploy(makeConfig({ source, destinations: new Map([[1, dest]]) }));
      await runtime.start();

      const both = Promise.all([runtime.stop(), runtime.stop()]);
      await settle();
      hung.finish();

      expect((await both).map((result) => result.ok)).toEqual([true, true]);
      expect(source.onStop).toHaveBeenCalledOnce();
      expect(dest.onStop).toHaveBeenCalledOnce();
    });

    it.each(['pause', 'resume'] as const)('refuses a %s that comes while it is under way', async (action) => {
      const source = makeSource();
      const hung = deferred();
      await runtime.deploy(makeConfig({ source }));
      await runtime.start();
      if (action === 'resume') await runtime.pause();
      (source.onStop as Mock).mockClear().mockReturnValueOnce(hung.promise);
      (source.onStart as Mock).mockClear();

      const stopped = runtime.stop();
      const result = await runtime[action]();

      expect(result.error?.message).toBe(`Cannot ${action}: the channel is stopping`);
      hung.finish();
      expect((await stopped).ok).toBe(true);
      expect(runtime.getState()).toBe('STOPPED');
      expect(source.onStart).not.toHaveBeenCalled();
    });
  });

  describe('the run signal', () => {
    it.each(['stop', 'halt'] as const)('is aborted as a %s begins, and not by a pause', async (action) => {
      const source = makeSource();
      await runtime.deploy(makeConfig({ source }));
      await runtime.start();
      const run = runtime.runSignal;
      await runtime.pause();
      await runtime.resume();
      expect(run.aborted).toBe(false);
      const atConnector: boolean[] = [];
      (action === 'stop' ? source.onStop as Mock : source.onHalt as Mock).mockImplementationOnce(async () => { atConnector.push(run.aborted); return ok(); });

      await runtime[action]();

      expect(atConnector).toEqual([true]);
    });

    it('is a new one for each start, and aborted while the channel is stopped', async () => {
      await runtime.deploy(makeConfig());
      expect(runtime.runSignal.aborted).toBe(true);
      await runtime.start();
      const first = runtime.runSignal;
      await runtime.stop();
      expect(runtime.runSignal.aborted).toBe(true);
      await runtime.start();

      expect(first.aborted).toBe(true);
      expect(runtime.runSignal.aborted).toBe(false);
    });
  });

  describe('pause/resume', () => {
    it('pause transitions to PAUSED', async () => {
      await runtime.deploy(makeConfig());
      await runtime.start();

      const result = await runtime.pause();

      expect(result.ok).toBe(true);
      expect(runtime.getState()).toBe('PAUSED');
    });

    it('pause stops source only', async () => {
      const source = makeSource();
      const dest = makeConnector();
      const config = makeConfig({ source, destinations: new Map([[1, dest]]) });

      await runtime.deploy(config);
      await runtime.start();
      await runtime.pause();

      expect(source.onStop).toHaveBeenCalledOnce();
      expect(dest.onStop).not.toHaveBeenCalled();
    });

    it('resume transitions PAUSED → STARTED', async () => {
      await runtime.deploy(makeConfig());
      await runtime.start();
      await runtime.pause();

      const result = await runtime.resume();

      expect(result.ok).toBe(true);
      expect(runtime.getState()).toBe('STARTED');
    });

    it('resume restarts source', async () => {
      const source = makeSource();
      const config = makeConfig({ source });

      await runtime.deploy(config);
      await runtime.start();
      await runtime.pause();
      await runtime.resume();

      expect(source.onStart).toHaveBeenCalledTimes(2);
    });

    it('cannot pause when not started', async () => {
      await runtime.deploy(makeConfig());

      const result = await runtime.pause();

      expect(result.ok).toBe(false);
    });

    it('cannot resume when not paused', async () => {
      await runtime.deploy(makeConfig());
      await runtime.start();

      const result = await runtime.resume();

      expect(result.ok).toBe(false);
    });

    it('can stop from paused state', async () => {
      await runtime.deploy(makeConfig());
      await runtime.start();
      await runtime.pause();

      const result = await runtime.stop();

      expect(result.ok).toBe(true);
      expect(runtime.getState()).toBe('STOPPED');
    });
  });

  describe('dispatcher wiring', () => {
    it('sets dispatcher on source during deploy', async () => {
      const source = makeSource();
      const config = makeConfig({ source });

      await runtime.deploy(config);

      expect(source.setDispatcher).toHaveBeenCalledWith(config.onMessage);
    });
  });

  describe('rollback on failure', () => {
    const failed = (message: string): Result<void> => ({ ok: false, value: null, error: new Error(message) }) as unknown as Result<void>;

    it('undeploys the connectors already deployed when a destination fails to deploy', async () => {
      const source = makeSource();
      const first = makeConnector();
      const second = makeConnector();
      (second.onDeploy as ReturnType<typeof vi.fn>).mockResolvedValue(failed('bad host'));

      const result = await runtime.deploy(makeConfig({ source, destinations: new Map([[1, first], [2, second]]) }));

      expect(result.ok ? '' : result.error.message).toBe('Destination 2 deploy failed: bad host');
      expect(source.onUndeploy).toHaveBeenCalledTimes(1);
      expect(first.onUndeploy).toHaveBeenCalledTimes(1);
      expect(second.onUndeploy).not.toHaveBeenCalled();
      expect(runtime.getState()).toBe('UNDEPLOYED');
    });

    it('can be deployed again after a failed deploy', async () => {
      const source = makeSource();
      (source.onDeploy as ReturnType<typeof vi.fn>).mockResolvedValueOnce(failed('boom'));
      const config = makeConfig({ source });

      expect((await runtime.deploy(config)).ok).toBe(false);
      expect((await runtime.deploy(config)).ok).toBe(true);
      expect(runtime.getState()).toBe('STOPPED');
    });

    it('stops the destinations already started when the source fails to start', async () => {
      const source = makeSource();
      const first = makeConnector();
      const second = makeConnector();
      (source.onStart as ReturnType<typeof vi.fn>).mockResolvedValue(failed('listen EADDRINUSE: address already in use :::6661'));
      await runtime.deploy(makeConfig({ source, destinations: new Map([[1, first], [2, second]]) }));

      const result = await runtime.start();

      expect(result.ok ? '' : result.error.message).toBe('Source start failed: listen EADDRINUSE: address already in use :::6661');
      expect(first.onStop).toHaveBeenCalledTimes(1);
      expect(second.onStop).toHaveBeenCalledTimes(1);
      expect(runtime.getState()).toBe('STOPPED');
    });

    it('stops only the destinations that started when a later one fails', async () => {
      const first = makeConnector();
      const second = makeConnector();
      const third = makeConnector();
      const source = makeSource();
      (second.onStart as ReturnType<typeof vi.fn>).mockResolvedValue(failed('no route'));
      await runtime.deploy(makeConfig({ source, destinations: new Map([[1, first], [2, second], [3, third]]) }));

      const result = await runtime.start();

      expect(result.ok ? '' : result.error.message).toBe('Destination 2 start failed: no route');
      expect(first.onStop).toHaveBeenCalledTimes(1);
      expect(third.onStart).not.toHaveBeenCalled();
      expect(source.onStart).not.toHaveBeenCalled();
    });

    it('can be started again once the cause is fixed', async () => {
      const source = makeSource();
      (source.onStart as ReturnType<typeof vi.fn>).mockResolvedValueOnce(failed('port busy'));
      await runtime.deploy(makeConfig({ source }));

      expect((await runtime.start()).ok).toBe(false);
      expect((await runtime.start()).ok).toBe(true);
      expect(runtime.getState()).toBe('STARTED');
    });

    it('reports a connector that fails to stop but still stops the rest', async () => {
      const source = makeSource();
      const dest = makeConnector();
      (source.onStop as ReturnType<typeof vi.fn>).mockResolvedValue(failed('socket stuck'));
      await runtime.deploy(makeConfig({ source, destinations: new Map([[1, dest]]) }));
      await runtime.start();

      const result = await runtime.stop();

      expect(result.ok ? '' : result.error.message).toBe('Source stop failed: socket stuck');
      expect(dest.onStop).toHaveBeenCalledTimes(1);
      expect(runtime.getState()).toBe('STOPPED');
    });
  });
});
