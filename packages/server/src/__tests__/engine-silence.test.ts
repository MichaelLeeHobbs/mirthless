// ===========================================
// Engine NO_MESSAGES Check Tests
// ===========================================
// EngineManager.checkSilentChannels hands each started channel's last-activity
// time to its AlertManager and restarts the clock for channels that are not
// running. Alert firing rules are covered in engine alert-manager.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { EngineManager, type DeployedChannel } from '../engine.js';

function fakeDeployed(state: string, lastAt: number): {
  deployed: DeployedChannel; checkSilence: ReturnType<typeof vi.fn>;
} {
  const checkSilence = vi.fn().mockResolvedValue(undefined);
  const deployed = {
    channelId: `id-${state}`,
    runtime: { getState: () => state },
    alertManager: { checkSilence },
    activity: { lastAt },
  } as unknown as DeployedChannel;
  return { deployed, checkSilence };
}

function runtimes(engine: EngineManager): Map<string, DeployedChannel> {
  return (engine as unknown as { runtimes: Map<string, DeployedChannel> }).runtimes;
}

describe('EngineManager.checkSilentChannels', () => {
  it('checks a started channel against its last activity time', async () => {
    const engine = new EngineManager();
    const { deployed, checkSilence } = fakeDeployed('STARTED', 1_000);
    runtimes(engine).set(deployed.channelId, deployed);

    await engine.checkSilentChannels(5_000);

    expect(checkSilence).toHaveBeenCalledWith('id-STARTED', 1_000, 5_000);
  });

  it('restarts the silence clock of a channel that is not started', async () => {
    const engine = new EngineManager();
    const { deployed, checkSilence } = fakeDeployed('STOPPED', 1_000);
    runtimes(engine).set(deployed.channelId, deployed);

    await engine.checkSilentChannels(5_000);

    expect(checkSilence).not.toHaveBeenCalled();
    expect(deployed.activity.lastAt).toBe(5_000);
  });

  it('keeps checking other channels when one check fails', async () => {
    const engine = new EngineManager();
    const failing = fakeDeployed('STARTED', 0);
    failing.checkSilence.mockRejectedValueOnce(new Error('smtp down'));
    const next = fakeDeployed('STARTED', 0);
    runtimes(engine).set('a', failing.deployed);
    runtimes(engine).set('b', { ...next.deployed, channelId: 'b' } as DeployedChannel);

    await expect(engine.checkSilentChannels(10)).resolves.toBeUndefined();

    expect(next.checkSilence).toHaveBeenCalledWith('b', 0, 10);
  });
});
