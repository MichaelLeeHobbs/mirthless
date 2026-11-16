// #228: which declarations the type service holds for a ScriptEditor. Monaco
// is faked (fake-monaco.tsx) so the editor mounts, takes focus and is typed in;
// the applied-surface tracking is the real one.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lightTheme } from '../../../styles/theme.js';
import { appliedSurfaceKey } from '../surface-state.js';
import { appliedSurfaces } from './fake-monaco.js';

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
});
