// #228: a settings panel keyed by position reused a removed destination's
// editors, and with equal scripts Ctrl+Z wrote its edits into the next one.

import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { fakeEditor } from '../../editors/__tests__/fake-monaco.js';
import { createDefaultDestination, JAVASCRIPT_DEST_DEFAULTS } from '../destinations/connector-defaults.js';
import type { DestinationFormValues } from '../destinations/types.js';

vi.mock('../../editors/monaco.js', async () => (await import('../../editors/__tests__/fake-monaco.js')).fakeMonacoModule());
vi.mock('@monaco-editor/react', async () => (await import('../../editors/__tests__/fake-monaco.js')).fakeMonacoReact);

const { DestinationsTab } = await import('../DestinationsTab.js');

afterEach(() => { cleanup(); });

const SAME = 'return msg;';
const destination = (name: string): DestinationFormValues => ({
  ...createDefaultDestination(0), name, connectorType: 'JAVASCRIPT', properties: { ...JAVASCRIPT_DEST_DEFAULTS, script: SAME },
});

let current: readonly DestinationFormValues[] = [];

function Harness(): React.ReactNode {
  const [destinations, setDestinations] = useState<readonly DestinationFormValues[]>([destination('To EHR'), destination('To Billing')]);
  current = destinations;
  return <DestinationsTab destinations={destinations} onChange={setDestinations} />;
}

function wrap(): void {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  render(<QueryClientProvider client={client}><ThemeProvider theme={lightTheme}><Harness /></ThemeProvider></QueryClientProvider>);
}

describe('DestinationsTab', () => {
  it('does not let undo carry a removed destination\'s edits into the next one', () => {
    wrap();
    const script = fakeEditor('Destination script');
    act(() => { script.type('return null;'); });
    act(() => { script.type(SAME); });
    fireEvent.click(screen.getByRole('button', { name: 'remove destination' }));
    expect(current.map((d) => d.name)).toEqual(['To Billing']);
    act(() => { fakeEditor('Destination script').undo(); });
    expect(current[0]!.properties['script']).toBe(SAME);
  });

  it('keeps a moved destination\'s own undo history with it', () => {
    wrap();
    const script = fakeEditor('Destination script');
    act(() => { script.type('return null;'); });
    act(() => { script.type(SAME); });
    fireEvent.click(screen.getByRole('button', { name: 'move destination down' }));
    act(() => { fakeEditor('Destination script').undo(); });
    // To EHR, now second and still selected, undoes its own edit.
    expect(current.map((d) => [d.name, d.properties['script']])).toEqual([['To Billing', SAME], ['To EHR', 'return null;']]);
  });
});
