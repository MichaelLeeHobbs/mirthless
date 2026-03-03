// ===========================================
// Sandbox Types Tests
// ===========================================
// Validates that SANDBOX_TYPE_DEFS contains expected declarations.

import { describe, it, expect } from 'vitest';
import { SANDBOX_TYPE_DEFS } from '../../../lib/sandbox-types.js';

describe('SANDBOX_TYPE_DEFS', () => {
  it('declares all sandbox global variables', () => {
    const expectedVars = [
      'msg', 'tmp', 'rawData', 'sourceMap', 'channelMap',
      'connectorMap', 'responseMap', 'globalChannelMap', 'logger',
    ];

    for (const varName of expectedVars) {
      expect(SANDBOX_TYPE_DEFS).toContain(`declare var ${varName}`);
    }
  });

  it('declares parseHL7 and createACK functions', () => {
    expect(SANDBOX_TYPE_DEFS).toContain('declare function parseHL7');
    expect(SANDBOX_TYPE_DEFS).toContain('declare function createACK');
  });

  it('defines Hl7MessageProxy interface with key methods', () => {
    expect(SANDBOX_TYPE_DEFS).toContain('interface Hl7MessageProxy');
    expect(SANDBOX_TYPE_DEFS).toContain('get(path: string)');
    expect(SANDBOX_TYPE_DEFS).toContain('set(path: string, value: string)');
    expect(SANDBOX_TYPE_DEFS).toContain('toString(): string');
    expect(SANDBOX_TYPE_DEFS).toContain('messageType');
    expect(SANDBOX_TYPE_DEFS).toContain('getSegmentCount');
  });

  it('defines SandboxLogger interface', () => {
    expect(SANDBOX_TYPE_DEFS).toContain('interface SandboxLogger');
    expect(SANDBOX_TYPE_DEFS).toContain('info(message: string): void');
    expect(SANDBOX_TYPE_DEFS).toContain('warn(message: string): void');
    expect(SANDBOX_TYPE_DEFS).toContain('error(message: string): void');
    expect(SANDBOX_TYPE_DEFS).toContain('debug(message: string): void');
  });
});
