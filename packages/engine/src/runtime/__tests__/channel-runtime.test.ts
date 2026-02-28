// ===========================================
// Channel Runtime Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from '@mirthless/core-util';
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
});
