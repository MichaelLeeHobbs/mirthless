import { describe, expect, it } from 'vitest';
import { MAX_SCRIPT_LOG_RUNS, readScriptLog, withScriptLogRun, type ScriptLogRun } from '../script-log.js';

function run(script: string): ScriptLogRun {
  return { script, lines: [{ level: 'INFO', time: '2026-11-25T10:00:00.000Z', text: `from ${script}` }], leftOut: 0 };
}

describe('withScriptLogRun', () => {
  it('starts a log, and adds to one in order', () => {
    const first = withScriptLogRun(null, run('Source filter'));
    const second = withScriptLogRun(first, run('Source transformer'));

    expect(readScriptLog(first)).toEqual({ runs: [run('Source filter')], earlierRuns: 0 });
    expect(readScriptLog(second)).toEqual({ runs: [run('Source filter'), run('Source transformer')], earlierRuns: 0 });
  });

  it('keeps the last runs and counts the ones before them', () => {
    let stored: string | null = null;
    for (let i = 1; i <= MAX_SCRIPT_LOG_RUNS + 3; i++) stored = withScriptLogRun(stored, run(`run ${String(i)}`));

    const log = readScriptLog(stored!);
    expect(log?.runs.map((r) => r.script)).toEqual(Array.from({ length: MAX_SCRIPT_LOG_RUNS }, (_, i) => `run ${String(i + 4)}`));
    expect(log?.earlierRuns).toBe(3);
  });

  it('starts again where what is stored is not a script log', () => {
    expect(readScriptLog(withScriptLogRun('not a log', run('Preprocessor')))).toEqual({ runs: [run('Preprocessor')], earlierRuns: 0 });
  });

  it('keeps text that a database text column cannot hold', () => {
    const odd = { ...run('Preprocessor'), lines: [{ level: 'ERROR' as const, time: 't', text: 'a\u0000b\ud800' }] };
    const stored = withScriptLogRun(null, odd);

    expect(stored).not.toContain('\u0000');
    expect(readScriptLog(stored)?.runs[0]?.lines[0]?.text).toBe('a\u0000b\ud800');
  });
});

describe('readScriptLog', () => {
  it.each([
    '', 'text', '{}', '[]',
    '{"runs":[{"script":"x","lines":[{"level":"TRACE","time":"t","text":"x"}],"leftOut":0}],"earlierRuns":0}',
    '{"runs":[{"script":"x","lines":[],"leftOut":"many"}],"earlierRuns":0}',
    '{"runs":[],"earlierRuns":-1}',
  ])('is null for %j', (stored) => {
    expect(readScriptLog(stored)).toBeNull();
  });
});
