// #228. Monaco is faked (fake-monaco.tsx); the applied-surface tracking is the real one.

import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lightTheme } from '../../../styles/theme.js';
import { appliedSurfaceKey, topLevelNames } from '../surface-state.js';
import { appliedSurfaces, fakeEditor } from './fake-monaco.js';

vi.mock('../monaco.js', async () => (await import('./fake-monaco.js')).fakeMonacoModule());
vi.mock('@monaco-editor/react', async () => (await import('./fake-monaco.js')).fakeMonacoReact);

const { ScriptEditor } = await import('../ScriptEditor.js');

afterEach(() => { cleanup(); appliedSurfaces.length = 0; });

function wrap(node: React.ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  render(<QueryClientProvider client={client}><ThemeProvider theme={lightTheme}>{node}</ThemeProvider></QueryClientProvider>);
}

describe('ScriptEditor surface', () => {
  // A JavaScript destination's script gets connectorMessage, channelId and
  // channelName; the editor dropped the flag, so TypeScript flagged them.
  it('declares connectorMessage, channelId and channelName for a JavaScript destination script', () => {
    wrap(<ScriptEditor value="" onChange={vi.fn()} language="TYPESCRIPT" surface={{ connectorMessage: true, templateContext: 'DESTINATION_FILTER_TRANSFORMER' }} />);
    const sandbox = appliedSurfaces.at(-1)?.files.find((f) => f.filePath === 'file:///sandbox.d.ts')?.content ?? '';
    expect(sandbox).toContain('declare var connectorMessage: ConnectorMessage;');
    expect(sandbox).toContain('declare var channelId: string;');
    expect(sandbox).toContain('declare var channelName: string;');
    expect(appliedSurfaceKey()).toBe(appliedSurfaces.at(-1)?.key);
  });

  function TwoSteps(): React.ReactNode {
    const [first, setFirst] = useState('');
    return (
      <>
        <ScriptEditor label="Step 1" value={first} onChange={setFirst} language="TYPESCRIPT" />
        <ScriptEditor label="Step 2" value="" onChange={vi.fn()} language="TYPESCRIPT" earlierNames={topLevelNames(first)} />
      </>
    );
  }

  const checkedWhenClicked = (label: string): HTMLElement | null =>
    within(screen.getByRole('group', { name: label })).queryByText('Types are checked when you click in');

  // Typing a declaration in step 1 changes step 2's declarations. Step 2 used
  // to apply them on every keystroke, so step 1, still focused, lost its own.
  it('keeps the focused editor\'s surface applied when another editor\'s declarations change', () => {
    wrap(<TwoSteps />);
    act(() => { fakeEditor('Step 1').focus(); });
    const focusedKey = appliedSurfaceKey();
    act(() => { fakeEditor('Step 1').type('const foo = 1;'); });
    expect(appliedSurfaceKey()).toBe(focusedKey);
    expect(checkedWhenClicked('Step 1')).toBeNull();
    expect(checkedWhenClicked('Step 2')).not.toBeNull();
  });

  it('applies an editor\'s surface when it takes focus', () => {
    wrap(<TwoSteps />);
    act(() => { fakeEditor('Step 1').focus(); });
    act(() => { fakeEditor('Step 1').type('const foo = 1;'); });
    act(() => { fakeEditor('Step 2').focus(); });
    expect(appliedSurfaces.at(-1)?.files.find((f) => f.filePath === 'file:///earlier-steps.d.ts')?.content).toBe('declare let foo: any;');
    expect(checkedWhenClicked('Step 2')).toBeNull();
    expect(checkedWhenClicked('Step 1')).not.toBeNull();
  });
});
