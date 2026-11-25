import { describe, expect, it } from 'vitest';
import { MAX_SCRIPT_LOG_CHARS, MAX_SCRIPT_LOG_FIRST_RUNS, MAX_SCRIPT_LOG_RUNS, readScriptLog, withScriptLogRun, type ScriptLogRun } from '../script-log.js';

function run(script: string): ScriptLogRun {
  return { script, lines: [{ level: 'INFO', time: '2026-11-25T10:00:00.000Z', text: `from ${script}` }], leftOut: 0 };
}

describe('withScriptLogRun', () => {
  it('starts a log, and adds to one in order', () => {
    const first = withScriptLogRun(null, run('Source filter'));
    const second = withScriptLogRun(first, run('Source transformer'));

    expect(readScriptLog(first)).toEqual({ runs: [run('Source filter')], runsLeftOut: 0 });
    expect(readScriptLog(second)).toEqual({ runs: [run('Source filter'), run('Source transformer')], runsLeftOut: 0 });
  });

  it('keeps the first and the last runs and counts the ones between', () => {
    let stored: string | null = null;
    for (let i = 1; i <= MAX_SCRIPT_LOG_RUNS + 3; i++) stored = withScriptLogRun(stored, run(`run ${String(i)}`));

    const log = readScriptLog(stored!);
    const numbers = Array.from({ length: MAX_SCRIPT_LOG_RUNS }, (_, i) => (i < MAX_SCRIPT_LOG_FIRST_RUNS ? i + 1 : i + 4));
    expect(log?.runs.map((r) => r.script)).toEqual(numbers.map((n) => `run ${String(n)}`));
    expect(log?.runsLeftOut).toBe(3);
  });

  it('keeps fewer of the last runs when they hold more text, and the very last whatever it holds', () => {
    const long = (script: string, chars: number): ScriptLogRun => ({ ...run(script), lines: [{ level: 'INFO', time: 't', text: 'x'.repeat(chars - 10) }, { level: 'INFO', time: 't', text: 'y'.repeat(10) }] });
    const tenth = MAX_SCRIPT_LOG_CHARS / 10;
    const add = (stored: string | null, name: string, chars: number): string => withScriptLogRun(stored, long(name, chars));
    const kept = (stored: string): [string, number | undefined] => [readScriptLog(stored)?.runs.map((r) => r.script).join('') ?? '', readScriptLog(stored)?.runsLeftOut];
    const ten = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].reduce((stored: string | null, name) => add(stored, name, tenth), null) ?? '';

    expect(kept(ten)).toEqual(['abcdefghij', 0]);
    const eleven = add(ten, 'k', tenth);
    expect(kept(eleven)).toEqual(['abcdeghijk', 1]);
    expect(kept(add(eleven, 'l', MAX_SCRIPT_LOG_CHARS))).toEqual(['abcdel', 6]);
  });

  it('starts again where what is stored is not a script log', () => {
    expect(readScriptLog(withScriptLogRun('not a log', run('Preprocessor')))).toEqual({ runs: [run('Preprocessor')], runsLeftOut: 0 });
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
    '{"runs":[{"script":"x","lines":[{"level":"TRACE","time":"t","text":"x"}],"leftOut":0}],"runsLeftOut":0}',
    '{"runs":[{"script":"x","lines":[],"leftOut":"many"}],"runsLeftOut":0}',
    '{"runs":[],"runsLeftOut":-1}',
  ])('is null for %j', (stored) => {
    expect(readScriptLog(stored)).toBeNull();
  });
});
