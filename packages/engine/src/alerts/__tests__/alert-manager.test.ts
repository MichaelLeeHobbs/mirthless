// ===========================================
// Alert Manager Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertManager } from '../alert-manager.js';
import type { LoadedAlert, ChannelErrorEvent } from '../alert-evaluator.js';
import type { ActionDispatcherDeps } from '../action-dispatcher.js';

// ----- Helpers -----

function makeEvent(overrides?: Partial<ChannelErrorEvent>): ChannelErrorEvent {
  return {
    channelId: 'ch-001',
    errorType: 'SOURCE_CONNECTOR',
    errorMessage: 'Connection refused',
    timestamp: 1000,
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

function makeDeps(): ActionDispatcherDeps {
  return {
    logger: { warn: vi.fn() },
  };
}

// ----- Setup -----

let manager: AlertManager;
let deps: ActionDispatcherDeps;

beforeEach(() => {
  vi.clearAllMocks();
  deps = makeDeps();
  manager = new AlertManager(deps);
});

// ----- loadAlerts / getAlerts -----

describe('AlertManager.loadAlerts', () => {
  it('loads alerts', () => {
    const alerts = [makeAlert()];
    manager.loadAlerts(alerts);
    expect(manager.getAlerts()).toEqual(alerts);
  });

  it('replaces previous alerts', () => {
    manager.loadAlerts([makeAlert({ id: 'a1' })]);
    manager.loadAlerts([makeAlert({ id: 'a2' })]);
    expect(manager.getAlerts()).toHaveLength(1);
    expect(manager.getAlerts()[0]?.id).toBe('a2');
  });
});

// ----- handleEvent -----

describe('AlertManager.handleEvent', () => {
  it('dispatches matching alert actions', async () => {
    manager.loadAlerts([makeAlert()]);
    await manager.handleEvent(makeEvent());

    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch for non-matching events', async () => {
    manager.loadAlerts([makeAlert({
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['DESTINATION_CONNECTOR'], regex: null },
    })]);

    await manager.handleEvent(makeEvent({ errorType: 'SOURCE_CONNECTOR' }));

    expect(deps.logger.warn).not.toHaveBeenCalled();
  });

  it('does not dispatch for disabled alerts', async () => {
    manager.loadAlerts([makeAlert({ enabled: false })]);
    await manager.handleEvent(makeEvent());

    expect(deps.logger.warn).not.toHaveBeenCalled();
  });
});

// ----- Throttling -----

describe('AlertManager throttling', () => {
  it('throttles re-alerts within interval', async () => {
    manager.loadAlerts([makeAlert({ reAlertIntervalMs: 5000 })]);

    // First alert at t=1000
    await manager.handleEvent(makeEvent({ timestamp: 1000 }));
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);

    // Second alert at t=2000 (within 5000ms interval) — should be throttled
    await manager.handleEvent(makeEvent({ timestamp: 2000 }));
    expect(deps.logger.warn).toHaveBeenCalledTimes(1); // Still 1

    // Third alert at t=7000 (after 5000ms interval) — should fire
    await manager.handleEvent(makeEvent({ timestamp: 7000 }));
    expect(deps.logger.warn).toHaveBeenCalledTimes(2);
  });

  it('does not throttle when reAlertIntervalMs is null', async () => {
    manager.loadAlerts([makeAlert({ reAlertIntervalMs: null })]);

    await manager.handleEvent(makeEvent({ timestamp: 1000 }));
    await manager.handleEvent(makeEvent({ timestamp: 1001 }));

    expect(deps.logger.warn).toHaveBeenCalledTimes(2);
  });

  it('does not throttle when reAlertIntervalMs is 0', async () => {
    manager.loadAlerts([makeAlert({ reAlertIntervalMs: 0 })]);

    await manager.handleEvent(makeEvent({ timestamp: 1000 }));
    await manager.handleEvent(makeEvent({ timestamp: 1001 }));

    expect(deps.logger.warn).toHaveBeenCalledTimes(2);
  });
});

// ----- Max alerts -----

describe('AlertManager max alerts', () => {
  it('stops after maxAlerts is reached', async () => {
    manager.loadAlerts([makeAlert({ maxAlerts: 2 })]);

    await manager.handleEvent(makeEvent({ timestamp: 1 }));
    await manager.handleEvent(makeEvent({ timestamp: 2 }));
    await manager.handleEvent(makeEvent({ timestamp: 3 })); // Should be blocked

    expect(deps.logger.warn).toHaveBeenCalledTimes(2);
  });

  it('does not limit when maxAlerts is null', async () => {
    manager.loadAlerts([makeAlert({ maxAlerts: null })]);

    await manager.handleEvent(makeEvent({ timestamp: 1 }));
    await manager.handleEvent(makeEvent({ timestamp: 2 }));
    await manager.handleEvent(makeEvent({ timestamp: 3 }));

    expect(deps.logger.warn).toHaveBeenCalledTimes(3);
  });
});

// ----- resetAlert -----

describe('AlertManager.resetAlert', () => {
  it('resets throttle state for a specific alert', async () => {
    manager.loadAlerts([makeAlert({ id: 'a1', maxAlerts: 1 })]);

    await manager.handleEvent(makeEvent({ timestamp: 1 }));
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);

    // This would be blocked by maxAlerts
    await manager.handleEvent(makeEvent({ timestamp: 2 }));
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);

    // Reset the alert
    manager.resetAlert('a1');

    // Now it should fire again
    await manager.handleEvent(makeEvent({ timestamp: 3 }));
    expect(deps.logger.warn).toHaveBeenCalledTimes(2);
  });
});

// ----- clearThrottleState -----

describe('AlertManager.clearThrottleState', () => {
  it('clears all throttle state', async () => {
    manager.loadAlerts([
      makeAlert({ id: 'a1', maxAlerts: 1 }),
      makeAlert({ id: 'a2', maxAlerts: 1 }),
    ]);

    await manager.handleEvent(makeEvent({ timestamp: 1 }));
    expect(deps.logger.warn).toHaveBeenCalledTimes(2);

    // Both blocked by maxAlerts
    await manager.handleEvent(makeEvent({ timestamp: 2 }));
    expect(deps.logger.warn).toHaveBeenCalledTimes(2);

    manager.clearThrottleState();

    // Both should fire again
    await manager.handleEvent(makeEvent({ timestamp: 3 }));
    expect(deps.logger.warn).toHaveBeenCalledTimes(4);
  });
});
