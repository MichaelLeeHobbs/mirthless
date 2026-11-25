import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { withScriptLogRun, type ScriptLog, type ScriptLogRun } from '@galvanigraph/core-models';
import { darkTheme } from '../../../styles/theme.js';
import { formatClockTime } from '../../../lib/format.js';
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

  it.each([
    [1, '1 more line of this run is not kept'],
    [50, '50 more lines of this run are not kept'],
  ])('says how many lines of a run were left out: %i', (leftOut, said) => {
    show(withScriptLogRun(null, run('Source filter', { leftOut })));
    expect(screen.getByText(said)).toBeTruthy();
  });

  it.each([
    [1, '1 earlier script run is not kept'],
    [3, '3 earlier script runs are not kept'],
  ])('says how many earlier runs are not kept: %i', (earlierRuns, said) => {
    show(text({ runs: [run('JavaScript destination')], earlierRuns }));
    expect(screen.getByText(said)).toBeTruthy();
  });

  it('shows what is stored as it is when it is not a script log', () => {
    show('something else');
    expect(screen.getByText('something else')).toBeTruthy();
  });
});
