// Runs the real controller, DeploymentService and EngineManager; only the deployed channel is faked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { DeployedChannel, EngineManager } from '../../engine.js';

let engine: EngineManager;

vi.mock('../../engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine.js')>();
  return { ...actual, getEngine: (): EngineManager => engine };
});

vi.mock('../../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const recordReadOrRefuse = vi.fn(async () => true);
vi.mock('../../lib/audited-read.js', () => ({ recordReadOrRefuse }));

const { EngineManager: RealEngineManager } = await import('../../engine.js');
const { DeploymentController } = await import('../deployment.controller.js');

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeReq(): Request {
  return { params: { id: CHANNEL_ID }, body: { content: 'MSH|raw' } } as unknown as Request;
}

/** Through the engine's private runtimes map. */
function deploy(state: string, processMessage: ReturnType<typeof vi.fn>): void {
  const deployed = { channelId: CHANNEL_ID, config: { name: 'Target' }, runtime: { getState: () => state, runSignal: new AbortController().signal }, processMessage } as unknown as DeployedChannel;
  (engine as unknown as { runtimes: Map<string, DeployedChannel> }).runtimes.set(CHANNEL_ID, deployed);
}

beforeEach(() => {
  engine = new RealEngineManager();
  recordReadOrRefuse.mockClear();
});

describe('DeploymentController.sendMessage', () => {
  it('answers 200 with the full dispatch outcome when the channel takes the message', async () => {
    const outcome = { messageId: 42, status: 'SENT', response: 'ACK' };
    const processMessage = vi.fn().mockResolvedValue({ ok: true, value: outcome, error: null });
    deploy('STARTED', processMessage);
    const res = makeRes();

    await DeploymentController.sendMessage(makeReq(), res);

    expect(processMessage).toHaveBeenCalledWith('MSH|raw');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: outcome });
    expect(recordReadOrRefuse).toHaveBeenCalledWith(expect.anything(), res, { action: 'MESSAGE_SENT', channelId: CHANNEL_ID, attributes: { contentLength: 7 }, rows: 1 });
    // Recorded before the channel saw the message.
    expect(recordReadOrRefuse.mock.invocationCallOrder[0]).toBeLessThan(processMessage.mock.invocationCallOrder[0] ?? 0);
  });

  it('does not send the message at all when the send cannot be recorded, so a retry is safe', async () => {
    const processMessage = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 43 }, error: null });
    deploy('STARTED', processMessage);
    recordReadOrRefuse.mockResolvedValueOnce(false);
    const res = makeRes();

    await DeploymentController.sendMessage(makeReq(), res);

    expect(processMessage).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('answers 404 NOT_FOUND when the channel is not deployed', async () => {
    const res = makeRes();

    await DeploymentController.sendMessage(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOT_FOUND', message: `Channel ${CHANNEL_ID} is not deployed` },
    });
    // The record is what counts a row against an API key's day (#419).
    expect(recordReadOrRefuse).not.toHaveBeenCalled();
  });

  it('answers 409 CONFLICT when the channel is not STARTED', async () => {
    const processMessage = vi.fn();
    deploy('STOPPED', processMessage);
    const res = makeRes();

    await DeploymentController.sendMessage(makeReq(), res);

    expect(processMessage).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'CONFLICT', message: 'Channel is STOPPED, must be STARTED to receive messages' },
    });
    expect(recordReadOrRefuse).not.toHaveBeenCalled();
  });

  it('answers 409 CONFLICT when the channel stopped while the send was being recorded', async () => {
    const processMessage = vi.fn();
    deploy('STARTED', processMessage);
    recordReadOrRefuse.mockImplementationOnce(async () => {
      deploy('STOPPED', processMessage);
      return true;
    });
    const res = makeRes();

    await DeploymentController.sendMessage(makeReq(), res);

    expect(processMessage).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('answers 409 CONFLICT with the cause when the channel fails to process the message', async () => {
    const processMessage = vi.fn().mockResolvedValue({ ok: false, value: null, error: new Error('Processing failed') });
    deploy('STARTED', processMessage);
    const res = makeRes();

    await DeploymentController.sendMessage(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'CONFLICT', message: 'Processing failed' },
    });
  });
});
