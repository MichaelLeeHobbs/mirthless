// ===========================================
// EngineManager.sendMessage Tests
// ===========================================
// The one implementation of "send a raw message to a started channel", used by
// the send-message API (through DeploymentService) and by routeMessage. Its
// ServiceError codes decide the HTTP status of POST /channels/:id/send-message.

import { describe, it, expect, vi } from 'vitest';
import { EngineManager, type DeployedChannel } from '../engine.js';

const CHANNEL_ID = 'id-Target';

function engineWith(state: string, processMessage: ReturnType<typeof vi.fn>): EngineManager {
  const engine = new EngineManager();
  const deployed = { channelId: CHANNEL_ID, config: { name: 'Target' }, runtime: { getState: () => state }, processMessage } as unknown as DeployedChannel;
  (engine as unknown as { runtimes: Map<string, DeployedChannel> }).runtimes.set(CHANNEL_ID, deployed);
  return engine;
}

describe('EngineManager.sendMessage', () => {
  it('returns the dispatch outcome from a STARTED channel', async () => {
    const outcome = { messageId: 42, status: 'SENT' };
    const processMessage = vi.fn().mockResolvedValue({ ok: true, value: outcome, error: null });
    const engine = engineWith('STARTED', processMessage);

    const result = await engine.sendMessage(CHANNEL_ID, 'MSH|raw');

    expect(result).toEqual({ ok: true, value: outcome, error: null });
    expect(processMessage).toHaveBeenCalledWith('MSH|raw');
  });

  it('fails with NOT_FOUND when the channel is not deployed', async () => {
    const result = await new EngineManager().sendMessage('missing', 'x');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    expect(result.error.message).toBe('Channel missing is not deployed');
  });

  it.each(['STOPPED', 'PAUSED', 'DEPLOYING'])('fails with CONFLICT without processing when the channel is %s', async (state) => {
    const processMessage = vi.fn();
    const engine = engineWith(state, processMessage);

    const result = await engine.sendMessage(CHANNEL_ID, 'x');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'CONFLICT');
    expect(result.error.message).toBe(`Channel is ${state}, must be STARTED to receive messages`);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('fails with CONFLICT carrying the cause when processMessage fails', async () => {
    const processMessage = vi.fn().mockResolvedValue({ ok: false, value: null, error: new Error('Processing failed') });
    const engine = engineWith('STARTED', processMessage);

    const result = await engine.sendMessage(CHANNEL_ID, 'x');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'CONFLICT');
    expect(result.error.message).toBe('Processing failed');
  });

  it('keeps the routeMessage error text when the target channel is not STARTED', async () => {
    const engine = engineWith('STOPPED', vi.fn());

    const result = await engine.routeMessage('Target', 'x');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Channel is STOPPED, must be STARTED to receive messages');
  });
});
