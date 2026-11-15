// ===========================================
// Alert templates: the placeholder rule
// ===========================================
// The six alert values are all strings, so the null, object and bigint rows of
// the shared rule cannot occur here.

import { describe, it, expect } from 'vitest';
import { substituteAlertTemplate } from '../action-dispatcher.js';
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
    ['a padded name', '<${ alertName }>', '<${ alertName }>'],
    ['a missing name', '<${error}>', '<${error}>'],
    ['a dotted name', '<${alert.name}>', '<${alert.name}>'],
    ['an inherited key', '<${toString}>', '<${toString}>'],
    ['a value containing ${alertName}', '<${errorMessage}>', '<bad ${alertName}>'],
    ['the timestamp', '<${timestamp}>', '<2024-03-02T00:00:00.000Z>'],
  ])('fills %s by the shared rule', (_label, template, expected) => {
    expect(substituteAlertTemplate(template, alert, event)).toBe(expected);
  });

  it('throws on an invalid timestamp, even when the template does not use it', () => {
    expect(() => substituteAlertTemplate('<${alertName}>', alert, { ...event, timestamp: Number.NaN })).toThrow(RangeError);
  });
});
