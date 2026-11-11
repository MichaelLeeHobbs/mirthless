// ===========================================
// Channel Runtime Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from '@galvaniflow/core-util';
import { ChannelRuntime } from '../channel-runtime.js';
import type { RuntimeSourceConnector, RuntimeConnector, ChannelRuntimeConfig } from '../channel-runtime.js';

// ----- Helpers -----

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

// ----- Tests -----

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

    it('cannot halt when stopped', async () => {
      await runtime.deploy(makeConfig());

      const result = await runtime.halt();

      expect(result.ok).toBe(false);
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

      // onStart called twice: once at start, once at resume
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
