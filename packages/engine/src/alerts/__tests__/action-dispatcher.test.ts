// ===========================================
// Action Dispatcher Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchActions, substituteAlertTemplate, type ActionDispatcherDeps } from '../action-dispatcher.js';
import type { LoadedAlert, ChannelErrorEvent } from '../alert-evaluator.js';

// ----- Helpers -----

function makeEvent(overrides?: Partial<ChannelErrorEvent>): ChannelErrorEvent {
  return {
    channelId: 'ch-001',
    errorType: 'SOURCE_CONNECTOR',
    errorMessage: 'Connection refused',
    timestamp: 1709337600000, // fixed timestamp for deterministic tests
    ...overrides,
  };
}

function makeAlert(overrides?: Partial<LoadedAlert>): LoadedAlert {
  return {
    id: 'alert-001',
    name: 'Test Alert',
    enabled: true,
    trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
    channelIds: [],
    actions: [{ id: 'a1', actionType: 'EMAIL', recipients: ['admin@test.com'], properties: null }],
    subjectTemplate: null,
    bodyTemplate: null,
    reAlertIntervalMs: null,
    maxAlerts: null,
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<ActionDispatcherDeps>): ActionDispatcherDeps {
  return {
    logger: { warn: vi.fn() },
    ...overrides,
  };
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
});

// ----- substituteAlertTemplate -----

describe('substituteAlertTemplate', () => {
  const alert = makeAlert({ name: 'My Alert' });
  const event = makeEvent({ channelId: 'ch-test', errorType: 'SOURCE_CONNECTOR', errorMessage: 'Timeout' });

  it('substitutes ${alertName}', () => {
    expect(substituteAlertTemplate('Alert: ${alertName}', alert, event)).toBe('Alert: My Alert');
  });

  it('substitutes ${channelId}', () => {
    expect(substituteAlertTemplate('Ch: ${channelId}', alert, event)).toBe('Ch: ch-test');
  });

  it('substitutes ${errorType}', () => {
    expect(substituteAlertTemplate('Type: ${errorType}', alert, event)).toBe('Type: SOURCE_CONNECTOR');
  });

  it('substitutes ${errorMessage}', () => {
    expect(substituteAlertTemplate('Err: ${errorMessage}', alert, event)).toBe('Err: Timeout');
  });

  it('substitutes ${timestamp}', () => {
    const result = substituteAlertTemplate('Time: ${timestamp}', alert, event);
    expect(result).toContain('Time: ');
    expect(result).toContain('2024'); // Fixed timestamp is in 2024
  });

  it('returns template unchanged when no placeholders', () => {
    expect(substituteAlertTemplate('plain text', alert, event)).toBe('plain text');
  });
});

// ----- dispatchActions -----

describe('dispatchActions', () => {
  it('logs EMAIL action as warning (deferred)', async () => {
    const deps = makeDeps();
    const alert = makeAlert({
      actions: [{ id: 'a1', actionType: 'EMAIL', recipients: ['admin@test.com'], properties: null }],
    });

    await dispatchActions(alert, makeEvent(), deps);

    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
    const [, message] = (deps.logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toContain('EMAIL action deferred');
  });

  it('dispatches CHANNEL action to channelSender', async () => {
    const channelSender = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ channelSender });
    const alert = makeAlert({
      actions: [{
        id: 'a1',
        actionType: 'CHANNEL',
        recipients: [],
        properties: { channelId: 'target-ch' },
      }],
    });

    await dispatchActions(alert, makeEvent(), deps);

    expect(channelSender).toHaveBeenCalledTimes(1);
    expect(channelSender).toHaveBeenCalledWith('target-ch', expect.any(String));
  });

  it('logs warning when CHANNEL action has no channelSender', async () => {
    const deps = makeDeps(); // No channelSender
    const alert = makeAlert({
      actions: [{
        id: 'a1',
        actionType: 'CHANNEL',
        recipients: [],
        properties: { channelId: 'target-ch' },
      }],
    });

    await dispatchActions(alert, makeEvent(), deps);

    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('logs warning when CHANNEL send fails', async () => {
    const channelSender = vi.fn().mockRejectedValue(new Error('send failed'));
    const deps = makeDeps({ channelSender });
    const alert = makeAlert({
      actions: [{
        id: 'a1',
        actionType: 'CHANNEL',
        recipients: [],
        properties: { channelId: 'target-ch' },
      }],
    });

    await dispatchActions(alert, makeEvent(), deps);

    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
    const [obj] = (deps.logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>];
    expect(obj['targetChannelId']).toBe('target-ch');
  });

  it('dispatches multiple actions', async () => {
    const channelSender = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ channelSender });
    const alert = makeAlert({
      actions: [
        { id: 'a1', actionType: 'EMAIL', recipients: ['admin@test.com'], properties: null },
        { id: 'a2', actionType: 'CHANNEL', recipients: [], properties: { channelId: 'ch-target' } },
      ],
    });

    await dispatchActions(alert, makeEvent(), deps);

    expect(deps.logger.warn).toHaveBeenCalledTimes(1); // EMAIL action
    expect(channelSender).toHaveBeenCalledTimes(1); // CHANNEL action
  });

  it('uses bodyTemplate when available', async () => {
    const channelSender = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ channelSender });
    const alert = makeAlert({
      bodyTemplate: 'ERROR in ${channelId}: ${errorMessage}',
      actions: [{
        id: 'a1',
        actionType: 'CHANNEL',
        recipients: [],
        properties: { channelId: 'target-ch' },
      }],
    });

    await dispatchActions(alert, makeEvent({ channelId: 'ch-src', errorMessage: 'bad data' }), deps);

    expect(channelSender).toHaveBeenCalledWith('target-ch', 'ERROR in ch-src: bad data');
  });

  it('uses default body when no template', async () => {
    const channelSender = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ channelSender });
    const alert = makeAlert({
      bodyTemplate: null,
      actions: [{
        id: 'a1',
        actionType: 'CHANNEL',
        recipients: [],
        properties: { channelId: 'target-ch' },
      }],
    });

    await dispatchActions(alert, makeEvent(), deps);

    const content = channelSender.mock.calls[0]?.[1] as string;
    expect(content).toContain('Alert: Test Alert');
    expect(content).toContain('Channel: ch-001');
    expect(content).toContain('Error: Connection refused');
  });
});
