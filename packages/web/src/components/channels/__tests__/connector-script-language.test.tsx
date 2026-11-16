// #228: a JavaScript connector's script with no stored scriptLanguage. Empty,
// the editor shows TypeScript, as for every new script; deploy reads a missing
// language as JavaScript. Typing in it must store the language the editor
// showed, or the script typed as TypeScript deploys unchecked. Monaco is faked
// (fake-monaco.tsx) so the editor can be typed in.

import { useState, type ReactElement } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { fakeEditor } from '../../editors/__tests__/fake-monaco.js';

vi.mock('../../editors/monaco.js', async () => (await import('../../editors/__tests__/fake-monaco.js')).fakeMonacoModule());
vi.mock('@monaco-editor/react', async () => (await import('../../editors/__tests__/fake-monaco.js')).fakeMonacoReact);

const { JavaScriptSourceForm } = await import('../source/JavaScriptSourceForm.js');
const { JavaScriptDestinationForm } = await import('../destinations/JavaScriptDestinationForm.js');

afterEach(() => { cleanup(); });

type Form = typeof JavaScriptSourceForm | typeof JavaScriptDestinationForm;
let lastProps: Record<string, unknown> = {};

function Harness({ Form, initial }: { readonly Form: Form; readonly initial: Record<string, unknown> }): ReactElement {
  const [props, setProps] = useState<Record<string, unknown>>(initial);
  lastProps = props;
  return <Form properties={props} onChange={(p) => { setProps(p); lastProps = p; }} />;
}

function renderForm(Form: Form, initial: Record<string, unknown>): void {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={lightTheme}><Harness Form={Form} initial={initial} /></ThemeProvider>
    </QueryClientProvider>,
  );
}

describe.each([
  ['source', JavaScriptSourceForm, 'Polling script'],
  ['destination', JavaScriptDestinationForm, 'Destination script'],
] as const)('JavaScript %s script with no stored language', (_name, Form, label) => {
  it('stores TypeScript, as shown, once the user types in an empty script', () => {
    renderForm(Form, { script: '' });
    act(() => { fakeEditor(label).type('return [];'); });
    expect(lastProps).toMatchObject({ script: 'return [];', scriptLanguage: 'TYPESCRIPT' });
  });

  it('stores JavaScript, as shown, once the user edits a script written before languages were stored', () => {
    renderForm(Form, { script: 'return [1];' });
    act(() => { fakeEditor(label).type('return [2];'); });
    expect(lastProps).toMatchObject({ script: 'return [2];', scriptLanguage: 'JAVASCRIPT' });
  });
});
