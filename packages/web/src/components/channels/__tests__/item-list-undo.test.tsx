// #228: items keyed by position reused an editor after a remove or move, and
// with equal texts Ctrl+Z put the removed item's earlier text into the next one.

import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { fakeEditor } from '../../editors/__tests__/fake-monaco.js';
import { createDefaultFilterRule, createDefaultTransformerStep, type FilterFormValues, type TransformerFormValues } from '../source/types.js';

vi.mock('../../editors/monaco.js', async () => (await import('../../editors/__tests__/fake-monaco.js')).fakeMonacoModule());
vi.mock('@monaco-editor/react', async () => (await import('../../editors/__tests__/fake-monaco.js')).fakeMonacoReact);

const { SourceTransformerSection } = await import('../source/SourceTransformerSection.js');
const { DestinationTransformerSection } = await import('../destinations/DestinationTransformerSection.js');
const { SourceFilterSection } = await import('../source/SourceFilterSection.js');
const { DestinationFilterSection } = await import('../destinations/DestinationFilterSection.js');

afterEach(() => { cleanup(); });

function wrap(node: React.ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  render(<QueryClientProvider client={client}><ThemeProvider theme={lightTheme}>{node}</ThemeProvider></QueryClientProvider>);
}

const SAME = 'return true;';
const transformer: TransformerFormValues = {
  inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundTemplate: null, outboundTemplate: null,
  inboundProperties: {}, outboundProperties: {},
  steps: [
    { ...createDefaultTransformerStep(), name: 'First', script: SAME },
    { ...createDefaultTransformerStep(), name: 'Second', script: SAME },
  ],
};
const filter: FilterFormValues = {
  rules: [
    { ...createDefaultFilterRule(), name: 'First', script: SAME },
    { ...createDefaultFilterRule(), name: 'Second', script: SAME },
  ],
};

type Section = 'transformer' | 'filter';
const SECTIONS = [
  ['source transformer', 'transformer', SourceTransformerSection, 'step'],
  ['destination transformer', 'transformer', DestinationTransformerSection, 'step'],
  ['source filter', 'filter', SourceFilterSection, 'rule'],
  ['destination filter', 'filter', DestinationFilterSection, 'rule'],
] as const;

let scripts: string[] = [];

function Harness({ kind, Component }: { readonly kind: Section; readonly Component: (typeof SECTIONS)[number][2] }): React.ReactNode {
  const [t, setT] = useState(transformer);
  const [f, setF] = useState(filter);
  scripts = kind === 'transformer' ? t.steps.map((s) => s.script) : f.rules.map((r) => r.script);
  // Two of the sections take a transformer, two a filter; `kind` says which.
  const C = Component as unknown as React.ComponentType<Record<string, unknown>>;
  return kind === 'transformer' ? <C transformer={t} onChange={setT} /> : <C filter={f} onChange={setF} />;
}

/** Edit the first item's script and put it back, so its editor has undo history but the same text. */
function editAndRestoreFirst(): void {
  const first = fakeEditor('First script');
  act(() => { first.type('return false;'); });
  act(() => { first.type(SAME); });
}

/** Open the section, then the first item's settings (where its order and remove buttons are). */
function openFirst(): void {
  fireEvent.click(screen.getByRole('button', { name: /^(Source|Destination)/ }));
  fireEvent.click(screen.getByRole('button', { name: /^First/ }));
}

describe.each(SECTIONS)('%s', (_name, kind, Component, noun) => {
  it('does not let undo carry a removed item\'s edits into the next one', () => {
    wrap(<Harness kind={kind} Component={Component} />);
    editAndRestoreFirst();
    openFirst();
    fireEvent.click(screen.getByRole('button', { name: `Remove ${noun}` }));
    act(() => { fakeEditor('Second script').undo(); });
    expect(scripts).toEqual([SAME]);
  });

  it('keeps each item\'s own undo history when items are moved', () => {
    wrap(<Harness kind={kind} Component={Component} />);
    editAndRestoreFirst();
    openFirst();
    fireEvent.click(screen.getByRole('button', { name: `Move ${noun} down` }));
    // Second is now first: undo there has nothing to undo.
    act(() => { fakeEditor('Second script').undo(); });
    expect(scripts).toEqual([SAME, SAME]);
    // First, now second, still undoes its own edit.
    act(() => { fakeEditor('First script').undo(); });
    expect(scripts).toEqual([SAME, 'return false;']);
  });
});
