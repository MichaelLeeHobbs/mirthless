// ===========================================
// Dispatch Status Mapping Tests
// ===========================================
// toDispatchStatus decides what a source connector tells the sender (MLLP
// ACK/NAK, HTTP status, whether a file or row is marked done). The channel's
// response mode decides whether a destination failure counts against the sender.

import { describe, it, expect } from 'vitest';
import { toDispatchStatus, toResponseSource } from '../engine.js';

const AFTER_SOURCE = ['AUTO_BEFORE', 'AUTO_AFTER_TRANSFORMER'] as const;
const AFTER_DESTINATIONS = ['AUTO_AFTER_DESTINATIONS', 'POSTPROCESSOR', 'DESTINATION', 'NONE', 'SOMETHING_NEW'] as const;
const ALL_MODES = [...AFTER_SOURCE, ...AFTER_DESTINATIONS];

describe('toDispatchStatus', () => {
  it.each(ALL_MODES)('reports a delivered message as PROCESSED under %s', (mode) => {
    expect(toDispatchStatus({ status: 'SENT' }, mode)).toBe('PROCESSED');
  });

  it.each(ALL_MODES)('reports a filtered message as FILTERED under %s', (mode) => {
    expect(toDispatchStatus({ status: 'FILTERED' }, mode)).toBe('FILTERED');
  });

  it.each(ALL_MODES)('always reports an error before routing under %s', (mode) => {
    expect(toDispatchStatus({ status: 'ERROR', errorStage: 'SOURCE' }, mode)).toBe('ERROR');
  });

  it.each(AFTER_DESTINATIONS)('reports a destination failure as ERROR under %s', (mode) => {
    expect(toDispatchStatus({ status: 'ERROR', errorStage: 'DESTINATION' }, mode)).toBe('ERROR');
  });

  it.each(AFTER_SOURCE)('reports a destination failure as PROCESSED under %s, so the sender does not resend', (mode) => {
    expect(toDispatchStatus({ status: 'ERROR', errorStage: 'DESTINATION' }, mode)).toBe('PROCESSED');
  });

  it.each(ALL_MODES)('treats an error with no stage as an error under %s', (mode) => {
    expect(toDispatchStatus({ status: 'ERROR' }, mode)).toBe('ERROR');
  });
});

describe('toResponseSource', () => {
  it('takes the response from the postprocessor in POSTPROCESSOR mode', () => {
    expect(toResponseSource('POSTPROCESSOR', null)).toEqual({ kind: 'POSTPROCESSOR' });
  });

  it('takes the response from the named destination in DESTINATION mode', () => {
    expect(toResponseSource('DESTINATION', 'To LIS')).toEqual({ kind: 'DESTINATION', destinationName: 'To LIS' });
  });

  it.each([['DESTINATION', null], ['AUTO_AFTER_DESTINATIONS', null], ['NONE', 'To LIS']] as const)(
    'leaves the default (first destination response) for %s with destination %s',
    (mode, name) => {
      expect(toResponseSource(mode, name)).toBeUndefined();
    },
  );
});
