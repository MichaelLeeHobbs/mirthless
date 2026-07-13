// ===========================================
// Status Level Mapping Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { channelStateLevel, messageStatusLevel } from '../status.js';

describe('channelStateLevel', () => {
  it('maps STARTED to healthy', () => {
    expect(channelStateLevel('STARTED')).toBe('healthy');
  });

  it('maps PAUSED to warning', () => {
    expect(channelStateLevel('PAUSED')).toBe('warning');
  });

  it('maps STOPPED to critical', () => {
    expect(channelStateLevel('STOPPED')).toBe('critical');
  });

  it('maps UNDEPLOYED to neutral', () => {
    expect(channelStateLevel('UNDEPLOYED')).toBe('neutral');
  });

  it('falls back to neutral for an unknown state', () => {
    expect(channelStateLevel('SOMETHING_ELSE')).toBe('neutral');
    expect(channelStateLevel('')).toBe('neutral');
  });
});

describe('messageStatusLevel', () => {
  it('maps SENT to healthy', () => {
    expect(messageStatusLevel('SENT')).toBe('healthy');
  });

  it('maps ERROR to critical', () => {
    expect(messageStatusLevel('ERROR')).toBe('critical');
  });

  it('maps QUEUED to warning', () => {
    expect(messageStatusLevel('QUEUED')).toBe('warning');
  });

  it('maps in-flight statuses to info', () => {
    expect(messageStatusLevel('FILTERED')).toBe('info');
    expect(messageStatusLevel('RECEIVED')).toBe('info');
    expect(messageStatusLevel('TRANSFORMED')).toBe('info');
  });

  it('falls back to neutral for an unknown status', () => {
    expect(messageStatusLevel('PENDING')).toBe('neutral');
    expect(messageStatusLevel('')).toBe('neutral');
  });
});
