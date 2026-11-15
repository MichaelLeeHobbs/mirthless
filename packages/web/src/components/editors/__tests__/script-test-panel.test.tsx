import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, getDefaultNormalizer } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ScriptTestResult } from '@galvaniflow/core-models';
import { lightTheme } from '../../../styles/theme.js';
import { ScriptTestPanel } from '../ScriptTestPanel.js';
import { ScriptEditor } from '../ScriptEditor.js';
import { ScriptTestSampleContext } from '../script-context.js';

afterEach(() => { cleanup(); });

function wrap(node: React.ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  render(<QueryClientProvider client={client}><ThemeProvider theme={lightTheme}>{node}</ThemeProvider></QueryClientProvider>);
}

const BASE: ScriptTestResult = {
  outcome: 'completed', output: null, returned: null, logs: [], maps: {}, destinations: null, skipped: [], error: null, durationMs: 12,
};

function panel(result: ScriptTestResult | undefined, extra: Partial<React.ComponentProps<typeof ScriptTestPanel>> = {}): void {
  wrap(
    <ScriptTestPanel
      dataType="HL7V2" sample="MSH|^~\&|" onSampleChange={vi.fn()} onRun={vi.fn()} running={false}
      result={result} requestError={undefined} {...extra}
    />,
  );
}

describe('ScriptTestPanel', () => {
  it('says how to run before the first run, and offers a fake ADT for HL7 channels', () => {
    panel(undefined);
    expect(screen.getByText(/Run the script \(Ctrl\+Enter in the editor\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate fake ADT' })).toBeTruthy();
    expect(screen.getByText('Kept in this page only. A test run sends, writes and routes nothing.')).toBeTruthy();
  });

  it('shows a filter outcome, logger lines, map changes and destinations', () => {
    panel({
      ...BASE, outcome: 'filtered', logs: [{ level: 'INFO', message: 'outpatient' }],
      maps: { channelMap: { mrn: '0004821193' } }, destinations: ['To EHR'],
    });
    expect(screen.getByText('Filtered out')).toBeTruthy();
    // Levels are padded to line up, so whitespace is kept as rendered.
    expect(screen.getByText('INFO  outpatient', { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) })).toBeTruthy();
    expect(screen.getByText(`channelMap['mrn'] = "0004821193"`)).toBeTruthy();
    expect(screen.getByText('To EHR')).toBeTruthy();
  });

  it('lists the calls a test run refused and shows the script error', () => {
    panel({ ...BASE, outcome: 'error', error: 'httpFetch https://x was not run', skipped: ['httpFetch https://x'] });
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('Not run (a test run has no side effects)')).toBeTruthy();
    expect(screen.getByText('httpFetch https://x')).toBeTruthy();
  });

  it('shows a failed request instead of a result', () => {
    panel(undefined, { requestError: 'Requires channels:write permission' });
    expect(screen.getByText('Requires channels:write permission')).toBeTruthy();
  });

  it('runs from its Run button', () => {
    const onRun = vi.fn();
    panel(undefined, { onRun });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalled();
  });
});

describe('ScriptEditor test run button', () => {
  const sample = { channelId: undefined, sample: '', setSample: vi.fn() };

  it('appears inside a channel for a script with a test kind, and opens the panel', () => {
    wrap(
      <ScriptTestSampleContext.Provider value={sample}>
        <ScriptEditor value="return true;" onChange={vi.fn()} testKind="filter" />
      </ScriptTestSampleContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test run' }));
    expect(screen.getByRole('region', { name: 'Test run' })).toBeTruthy();
  });

  it('is absent outside a channel and for a read-only script', () => {
    wrap(<ScriptEditor value="" onChange={vi.fn()} testKind="filter" />);
    expect(screen.queryByRole('button', { name: 'Test run' })).toBeNull();
    cleanup();
    wrap(
      <ScriptTestSampleContext.Provider value={sample}>
        <ScriptEditor value="" onChange={vi.fn()} testKind="filter" readOnly />
      </ScriptTestSampleContext.Provider>,
    );
    expect(screen.queryByRole('button', { name: 'Test run' })).toBeNull();
  });
});
