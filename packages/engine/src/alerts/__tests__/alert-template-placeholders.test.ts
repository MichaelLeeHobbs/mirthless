// ===========================================
// Alert templates: the placeholder rule
// ===========================================
// The six alert values are all strings, so the null, object and bigint rows of
// the shared rule cannot occur here.

import { describe, it, expect, vi } from 'vitest';
import { dispatchActions, substituteAlertTemplate } from '../action-dispatcher.js';
import type { LoadedAlert, ChannelErrorEvent } from '../alert-evaluator.js';

const alert: LoadedAlert = {
  id: 'alert-001',
  name: 'My Alert',
  enabled: true,
  trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
  channelIds: [],
  actions: [],
  subjectTemplate: null,
  bodyTemplate: null,
  reAlertIntervalMs: null,
  maxAlerts: null,
};

const event: ChannelErrorEvent = {
  channelId: 'ch-1',
  errorType: 'SOURCE_CONNECTOR',
  errorMessage: 'bad ${alertName}',
  timestamp: 1709337600000,
};

describe('substituteAlertTemplate', () => {
  it.each([
    ['a plain name', '<${alertName}>', '<My Alert>'],
    ['a padded name', '<${ alertName }>', '<My Alert>'],
    ['a missing name', '<${error}>', '<${error}>'],
    ['a dotted name', '<${alert.name}>', '<${alert.name}>'],
    ['a padded dotted name', '<${ alert.name }>', '<${ alert.name }>'],
    ['an inherited key', '<${toString}>', '<${toString}>'],
    ['a value containing ${alertName}', '<${errorMessage}>', '<bad ${alertName}>'],
    ['the timestamp', '<${timestamp}>', '<2024-03-02T00:00:00.000Z>'],
  ])('fills %s by the shared rule', (_label, template, expected) => {
    expect(substituteAlertTemplate(template, alert, event)).toBe(expected);
  });

  it('fills the other names and leaves ${timestamp} as written when the event time is invalid', () => {
    const bad = { ...event, timestamp: Number.NaN };
    expect(substituteAlertTemplate('${alertName} at ${timestamp}', alert, bad)).toBe('My Alert at ${timestamp}');
  });

  // The type says number, but an event built from stored or external data can lack its time.
  // A missing time is not the 1970 epoch: it stays as written, like an invalid one.
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('leaves ${timestamp} as written when the event time is %s', (_label, missing) => {
    const noTime = { ...event, timestamp: missing as unknown as number };
    expect(substituteAlertTemplate('${alertName} at ${timestamp}', alert, noTime)).toBe('My Alert at ${timestamp}');
  });
});

describe('dispatchActions with an invalid event time', () => {
  it.each([
    ['a body template', 'At ${timestamp}: ${errorMessage}', 'At ${timestamp}: bad ${alertName}'],
    ['the default body', null, 'Time: invalid timestamp'],
  ])('still sends the alert with %s', async (_label, bodyTemplate, expected) => {
    const channelSender = vi.fn().mockResolvedValue(undefined);
    const withChannel: LoadedAlert = {
      ...alert, bodyTemplate,
      actions: [{ id: 'a1', actionType: 'CHANNEL', recipients: [], properties: { channelId: 'target' } }],
    };
    await dispatchActions(withChannel, { ...event, timestamp: Number.NaN }, { logger: { warn: vi.fn() }, channelSender });
    expect(channelSender).toHaveBeenCalledWith('target', expect.stringContaining(expected));
  });
});
