// ===========================================
// SMTP Destination Form — Attachments Editor Tests
// ===========================================
// Verifies the config-driven multi-attachment editor (rank-9): add/remove rows
// and field edits write the { filename, mimeType, content } shape into
// props.attachments that the registry's readSmtpAttachments consumes.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';

// TestConnectionButton pulls in socket/query wiring irrelevant here.
vi.mock('../../common/TestConnectionButton.js', () => ({
  TestConnectionButton: () => null,
}));

import { SmtpDestinationForm } from '../destinations/SmtpDestinationForm.js';

let lastProps: Record<string, unknown> = {};

function Harness({ initial }: { initial: Record<string, unknown> }): ReactElement {
  const [props, setProps] = useState<Record<string, unknown>>(initial);
  lastProps = props;
  return (
    <SmtpDestinationForm
      properties={props}
      onChange={(p) => { setProps(p); lastProps = p; }}
    />
  );
}

function renderForm(initial: Record<string, unknown>): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={darkTheme}>
        <Harness initial={initial} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function attachments(): ReadonlyArray<Record<string, unknown>> {
  return (lastProps['attachments'] ?? []) as ReadonlyArray<Record<string, unknown>>;
}

// Non-empty initial props so the form's default-seeding effect stays inert.
const BASE = { host: 'smtp.example.com', from: 'a@b.com', to: 'c@d.com', attachments: [] };

afterEach(() => { cleanup(); lastProps = {}; });

describe('SmtpDestinationForm — attachments editor', () => {
  it('adds a row with the default shape when Add Attachment is clicked', () => {
    renderForm({ ...BASE });

    fireEvent.click(screen.getByRole('button', { name: 'Add Attachment' }));

    expect(attachments()).toEqual([{ filename: '', mimeType: 'text/plain', content: '' }]);
  });

  it('writes filename/mimeType/content edits into props.attachments', () => {
    renderForm({ ...BASE, attachments: [{ filename: '', mimeType: 'text/plain', content: '' }] });

    fireEvent.change(screen.getByLabelText('Filename'), { target: { value: 'result.csv' } });
    fireEvent.change(screen.getByLabelText('MIME Type'), { target: { value: 'text/csv' } });
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'body: ${msg}' } });

    expect(attachments()).toEqual([
      { filename: 'result.csv', mimeType: 'text/csv', content: 'body: ${msg}' },
    ]);
  });

  it('removes a row when Remove is clicked', () => {
    renderForm({ ...BASE, attachments: [{ filename: 'a.txt', mimeType: 'text/plain', content: 'x' }] });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(attachments()).toEqual([]);
  });

  it('keeps the Attach Message Content switch alongside the attachments editor', () => {
    renderForm({ ...BASE });
    expect(screen.getByLabelText('Attach Message Content')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Attachment' })).toBeTruthy();
  });
});
