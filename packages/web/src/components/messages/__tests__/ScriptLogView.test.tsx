import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MAX_SCRIPT_LOG_FIRST_RUNS, withScriptLogRun, type ScriptLog, type ScriptLogRun } from '@galvanigraph/core-models';
import { darkTheme } from '../../../styles/theme.js';
import { formatClockTime, formatTimestamp } from '../../../lib/format.js';
import { ScriptLogView } from '../ScriptLogView.js';

const TIME = '2026-11-25T10:00:00.123Z';

function run(script: string, overrides: Partial<ScriptLogRun> = {}): ScriptLogRun {
  return { script, lines: [{ level: 'INFO', time: TIME, text: 'hello' }], leftOut: 0, ...overrides };
}

function show(content: string): void {
  render(<ThemeProvider theme={darkTheme}><ScriptLogView content={content} /></ThemeProvider>);
}

const text = (log: ScriptLog): string => JSON.stringify(log);

afterEach(cleanup);

describe('ScriptLogView', () => {
  it('shows each run under its script, with the time, level and text of each line', () => {
    show(withScriptLogRun(
      withScriptLogRun(null, run('Source filter', { lines: [{ level: 'WARN', time: TIME, text: 'no MRN' }, { level: 'DEBUG', time: TIME, text: 'two\nlines' }] })),
      run('Source transformer'),
    ));

    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Source filter', 'Source transformer']);
    const filter = screen.getByLabelText('Log of Source filter');
    expect([...filter.children].map((line) => line.textContent)).toEqual([
      `${formatClockTime(TIME)} WARN  no MRN`,
      `${formatClockTime(TIME)} DEBUG two\nlines`,
    ]);
    expect(screen.getByLabelText('Log of Source transformer').textContent).toContain('INFO  hello');
    expect(screen.queryByText(/not kept/)).toBeNull();
  });

  it('shows when a run was, and an HL7 message line by line', () => {
    show(withScriptLogRun(null, run('Source filter', { lines: [{ level: 'INFO', time: TIME, text: 'MSH|^~\\&\rPID|1\r\nOBX|1' }] })));

    expect(screen.getByText(formatTimestamp(TIME))).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Log of Source filter' }).textContent).toContain('MSH|^~\\&\nPID|1\nOBX|1');
  });

  it.each([
    [1, '1 more line of this run is not kept'],
    [50, '50 more lines of this run are not kept'],
  ])('says how many lines of a run were left out: %i', (leftOut, said) => {
    show(withScriptLogRun(null, run('Source filter', { leftOut })));
    expect(screen.getByText(said)).toBeTruthy();
  });

  it.each([
    [1, '1 script run between these is not kept'],
    [3, '3 script runs between these are not kept'],
  ])('says between the first and the last runs how many are not kept: %i', (runsLeftOut, said) => {
    const runs = Array.from({ length: MAX_SCRIPT_LOG_FIRST_RUNS + 1 }, (_, i) => run(`run ${String(i)}`));
    show(text({ runs, runsLeftOut }));

    const note = screen.getByText(said);
    const last = screen.getByRole('heading', { name: `run ${String(MAX_SCRIPT_LOG_FIRST_RUNS)}` });
    const before = screen.getByRole('heading', { name: `run ${String(MAX_SCRIPT_LOG_FIRST_RUNS - 1)}` });
    expect(before.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(last.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('says nothing of the kind between runs of which none is left out', () => {
    show(text({ runs: Array.from({ length: MAX_SCRIPT_LOG_FIRST_RUNS + 1 }, (_, i) => run(`run ${String(i)}`)), runsLeftOut: 0 }));
    expect(screen.queryByText(/not kept/)).toBeNull();
  });

  it('shows what is stored as it is when it is not a script log', () => {
    show('something else');
    expect(screen.getByText('something else')).toBeTruthy();
  });
});
