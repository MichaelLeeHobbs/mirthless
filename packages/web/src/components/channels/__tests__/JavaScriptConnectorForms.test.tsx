// Monaco is stubbed (test/setup.ts), so these cover the editor chrome and what
// the forms write (#200).

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactElement } from 'react';
import { lightTheme } from '../../../styles/theme.js';
import { JavaScriptSourceForm } from '../source/JavaScriptSourceForm.js';
import { JavaScriptDestinationForm } from '../destinations/JavaScriptDestinationForm.js';
import { JAVASCRIPT_SOURCE_DEFAULTS } from '../source/connector-defaults.js';
import { JAVASCRIPT_DEST_DEFAULTS } from '../destinations/connector-defaults.js';

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
] as const)('JavaScript %s form', (_name, Form, label) => {
  it('edits the script in the script editor', () => {
    renderForm(Form, { script: 'return [];', scriptLanguage: 'TYPESCRIPT' });
    expect(screen.getByRole('group', { name: label })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'TypeScript' })).toBeTruthy();
  });

  it('stores a language switch in the connector properties, keeping the script', () => {
    renderForm(Form, { script: 'return [];', scriptLanguage: 'TYPESCRIPT' });
    fireEvent.click(screen.getByRole('button', { name: 'JavaScript' }));
    expect(lastProps).toMatchObject({ script: 'return [];', scriptLanguage: 'JAVASCRIPT' });
  });

  it('reads a saved script with no language as JavaScript, how it was written', () => {
    renderForm(Form, { script: 'return [];' });
    expect(screen.getByText('JavaScript', { selector: 'span' })).toBeTruthy();
  });
});

describe('new JavaScript connectors', () => {
  it('start their script in TypeScript, as every new script does', () => {
    expect(JAVASCRIPT_SOURCE_DEFAULTS['scriptLanguage']).toBe('TYPESCRIPT');
    expect(JAVASCRIPT_DEST_DEFAULTS['scriptLanguage']).toBe('TYPESCRIPT');
  });
});
