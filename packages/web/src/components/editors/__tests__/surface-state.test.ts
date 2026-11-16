// #183: Monaco's TypeScript service has one set of declarations for every
// editor. These cover the state that lets an editor tell whether its own set is
// the one applied, and the declarations a transformer step gets for the names
// the steps before it declare (deploy checks the steps joined).

import { describe, it, expect, vi } from 'vitest';
import {
  appliedSurfaceKey, earlierStepNames, markSurfaceApplied, onSurfaceApplied, surfaceLibs, topLevelNames,
} from '../surface-state.js';

const SOURCE = { dataType: 'HL7V2', templateContext: 'SOURCE_FILTER_TRANSFORMER' } as const;
const DEPLOY = { message: false, templateContext: 'CHANNEL_DEPLOY' } as const;

describe('surfaceLibs', () => {
  it('gives two surfaces different keys and the same surface the same key', () => {
    expect(surfaceLibs(SOURCE, []).key).toBe(surfaceLibs({ ...SOURCE }, []).key);
    expect(surfaceLibs(SOURCE, []).key).not.toBe(surfaceLibs(DEPLOY, []).key);
  });

  it('declares the names of earlier steps, so a step can use them', () => {
    const libs = surfaceLibs(SOURCE, [], ['hl7', 'patientId']);
    const earlier = libs.files.find((f) => f.filePath === 'file:///earlier-steps.d.ts');
    expect(earlier?.content).toBe('declare let hl7: any;\ndeclare let patientId: any;');
    expect(libs.key).not.toBe(surfaceLibs(SOURCE, []).key);
  });

  it('leaves out an earlier name the sandbox already declares', () => {
    const libs = surfaceLibs(SOURCE, [], ['channelMap', 'mine']);
    expect(libs.files.find((f) => f.filePath === 'file:///earlier-steps.d.ts')?.content).toBe('declare let mine: any;');
  });
});

describe('applied surface', () => {
  it('tells listeners when another surface is applied, and not when the same one is', () => {
    const listener = vi.fn();
    const off = onSurfaceApplied(listener);
    markSurfaceApplied('a');
    listener.mockClear();
    expect(markSurfaceApplied('a')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(markSurfaceApplied('b')).toBe(true);
    expect(appliedSurfaceKey()).toBe('b');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    markSurfaceApplied('c');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('topLevelNames', () => {
  it('reads the names a step declares at the start of a line', () => {
    const code = [
      "const hl7 = msg;",
      'let count = 0;',
      'var legacy = 1;',
      'function helper() { return 1; }',
      'async function load() {}',
      'class Thing {}',
      'if (x) {',
      '  const inner = 1;',
      '}',
    ].join('\n');
    expect(topLevelNames(code)).toEqual(['hl7', 'count', 'legacy', 'helper', 'load', 'Thing']);
  });

  it('reads nothing from a step that declares nothing', () => {
    expect(topLevelNames("tmp['PID.3'] = msg['PID.3'];")).toEqual([]);
  });
});

describe('earlierStepNames', () => {
  const step = (script: string, enabled = true): { enabled: boolean; script: string } => ({ enabled, script });

  it('gives a step the names of the enabled steps before it, as deploy joins them', () => {
    const steps = [step('const a = 1;'), step('const off = 1;', false), step(''), step('const b = a;'), step('const later = 1;')];
    expect(earlierStepNames(steps, 3)).toEqual(['a']);
    expect(earlierStepNames(steps, 4)).toEqual(['a', 'b']);
    expect(earlierStepNames(steps, 0)).toEqual([]);
  });
});
