// ===========================================
// Alert Evaluator Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { evaluateAlerts, type ChannelErrorEvent, type LoadedAlert } from '../alert-evaluator.js';

// ----- Helpers -----

function makeEvent(overrides?: Partial<ChannelErrorEvent>): ChannelErrorEvent {
  return {
    channelId: 'ch-001',
    errorType: 'SOURCE_CONNECTOR',
    errorMessage: 'Connection refused',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeAlert(overrides?: Partial<LoadedAlert>): LoadedAlert {
  return {
    id: 'alert-001',
    name: 'Test Alert',
    enabled: true,
    trigger: {
      type: 'CHANNEL_ERROR',
      errorTypes: ['ANY'],
      regex: null,
    },
    channelIds: [],
    actions: [{ id: 'a1', actionType: 'EMAIL', recipients: ['test@test.com'], properties: null }],
    subjectTemplate: null,
    bodyTemplate: null,
    reAlertIntervalMs: null,
    maxAlerts: null,
    ...overrides,
  };
}

// ----- Tests -----

describe('evaluateAlerts', () => {
  it('matches alert with ANY error type', () => {
    const event = makeEvent({ errorType: 'SOURCE_CONNECTOR' });
    const alerts = [makeAlert()];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(1);
  });

  it('matches alert with specific error type', () => {
    const event = makeEvent({ errorType: 'SOURCE_CONNECTOR' });
    const alerts = [makeAlert({
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['SOURCE_CONNECTOR'], regex: null },
    })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(1);
  });

  it('does not match alert with non-matching error type', () => {
    const event = makeEvent({ errorType: 'SOURCE_CONNECTOR' });
    const alerts = [makeAlert({
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['DESTINATION_CONNECTOR'], regex: null },
    })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(0);
  });

  it('matches when channel is in channelIds scope', () => {
    const event = makeEvent({ channelId: 'ch-abc' });
    const alerts = [makeAlert({ channelIds: ['ch-abc', 'ch-def'] })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(1);
  });

  it('does not match when channel is not in channelIds scope', () => {
    const event = makeEvent({ channelId: 'ch-other' });
    const alerts = [makeAlert({ channelIds: ['ch-abc', 'ch-def'] })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(0);
  });

  it('matches all channels when channelIds is empty', () => {
    const event = makeEvent({ channelId: 'ch-any' });
    const alerts = [makeAlert({ channelIds: [] })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(1);
  });

  it('matches when error message matches regex', () => {
    const event = makeEvent({ errorMessage: 'Connection refused on port 5432' });
    const alerts = [makeAlert({
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: 'Connection refused' },
    })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(1);
  });

  it('does not match when error message does not match regex', () => {
    const event = makeEvent({ errorMessage: 'Timeout occurred' });
    const alerts = [makeAlert({
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: 'Connection refused' },
    })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(0);
  });

  it('ignores disabled alerts', () => {
    const event = makeEvent();
    const alerts = [makeAlert({ enabled: false })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(0);
  });

  it('handles invalid regex gracefully (no match)', () => {
    const event = makeEvent({ errorMessage: 'test' });
    const alerts = [makeAlert({
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: '[invalid' },
    })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(0);
  });

  it('matches multiple alerts for the same event', () => {
    const event = makeEvent();
    const alerts = [
      makeAlert({ id: 'a1', name: 'Alert 1' }),
      makeAlert({ id: 'a2', name: 'Alert 2' }),
    ];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(2);
  });

  it('handles empty alerts array', () => {
    const event = makeEvent();
    const matched = evaluateAlerts(event, []);
    expect(matched).toHaveLength(0);
  });

  it('ignores alerts with non-CHANNEL_ERROR trigger type', () => {
    const event = makeEvent();
    const alerts = [makeAlert({
      trigger: { type: 'UNKNOWN', errorTypes: ['ANY'], regex: null },
    })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(0);
  });

  it('matches with multiple error types in trigger', () => {
    const event = makeEvent({ errorType: 'DESTINATION_FILTER' });
    const alerts = [makeAlert({
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['SOURCE_CONNECTOR', 'DESTINATION_FILTER'], regex: null },
    })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(1);
  });

  it('handles regex with special characters', () => {
    const event = makeEvent({ errorMessage: 'Error: timeout (30s)' });
    const alerts = [makeAlert({
      trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: 'timeout \\(\\d+s\\)' },
    })];

    const matched = evaluateAlerts(event, alerts);
    expect(matched).toHaveLength(1);
  });
});
