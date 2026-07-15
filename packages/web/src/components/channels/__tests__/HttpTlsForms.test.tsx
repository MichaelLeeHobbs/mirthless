// ===========================================
// HTTP Source/Destination TLS Form Tests
// ===========================================
// Verifies the HTTP/HTTPS Mode select toggles the certificate pickers and that
// selecting certificates writes the id-based tls shape the server spine expects
// (scheme + tls.{caCertId/clientCertId/serverCertId/rejectUnauthorized/
// requireClientCert}). No raw PEM fields.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';

// Mock the certificate list hook the CertificateSelect depends on.
const CERTS = [
  { id: 'ca-1', name: 'Internal CA', type: 'CA', notAfter: '2099-01-01T00:00:00.000Z', hasPrivateKey: false },
  { id: 'srv-1', name: 'Listener Cert', type: 'SERVER', notAfter: '2099-01-01T00:00:00.000Z', hasPrivateKey: true },
  { id: 'cli-1', name: 'Client Cert', type: 'CLIENT', notAfter: '2099-01-01T00:00:00.000Z', hasPrivateKey: true },
];
vi.mock('../../../hooks/use-certificates.js', () => ({
  useCertificates: (query?: { type?: string }) => ({
    data: CERTS.filter((c) => !query?.type || c.type === query.type),
    isLoading: false,
  }),
}));

// Mock TestConnectionButton — it pulls in socket/query wiring irrelevant here.
vi.mock('../../common/TestConnectionButton.js', () => ({
  TestConnectionButton: () => null,
}));

import { HttpDestinationForm } from '../destinations/HttpDestinationForm.js';
import { HttpSourceForm } from '../source/HttpSourceForm.js';

interface FormLike {
  (props: { properties: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }): ReactElement | null;
}

let lastProps: Record<string, unknown> = {};

function Harness({ Form, initial }: { Form: FormLike; initial: Record<string, unknown> }): ReactElement {
  const [props, setProps] = useState<Record<string, unknown>>(initial);
  lastProps = props;
  return <Form properties={props} onChange={(p) => { setProps(p); lastProps = p; }} />;
}

function renderForm(Form: FormLike, initial: Record<string, unknown>): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={darkTheme}>
        <Harness Form={Form} initial={initial} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function tls(): Record<string, unknown> {
  return (lastProps['tls'] ?? {}) as Record<string, unknown>;
}

/** Open an MUI TextField-select and click the option with the given label. */
function selectOption(triggerLabel: string, optionName: string): void {
  fireEvent.mouseDown(screen.getByLabelText(triggerLabel));
  const listbox = screen.getByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: optionName }));
}

/** Open an MUI Autocomplete and click the option matching the given text. */
function pickCert(pickerLabel: RegExp | string, optionText: RegExp): void {
  const input = screen.getByLabelText(pickerLabel);
  input.focus();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  const listbox = screen.getByRole('listbox');
  fireEvent.click(within(listbox).getByText(optionText));
}

afterEach(() => { cleanup(); lastProps = {}; });

describe('HttpDestinationForm — HTTPS mode', () => {
  it('hides certificate pickers in HTTP mode', () => {
    renderForm(HttpDestinationForm as unknown as FormLike, { scheme: 'HTTP', tls: {} });
    expect(screen.queryByLabelText('Trust CA')).toBeNull();
    expect(screen.queryByLabelText('Client certificate (mTLS)')).toBeNull();
  });

  it('shows pickers and sets scheme=HTTPS when Mode switches to HTTPS', () => {
    renderForm(HttpDestinationForm as unknown as FormLike, { scheme: 'HTTP', tls: { rejectUnauthorized: true } });

    selectOption('Mode', 'HTTPS');

    expect(lastProps['scheme']).toBe('HTTPS');
    expect(screen.getByLabelText('Trust CA')).toBeTruthy();
    expect(screen.getByLabelText('Client certificate (mTLS)')).toBeTruthy();
  });

  it('writes tls.clientCertId (id reference) when a client cert is picked', () => {
    renderForm(HttpDestinationForm as unknown as FormLike, {
      scheme: 'HTTPS', tls: { caCertId: '', clientCertId: '', rejectUnauthorized: true },
    });

    pickCert('Client certificate (mTLS)', /Client Cert/);

    expect(tls()['clientCertId']).toBe('cli-1');
    expect(lastProps['scheme']).toBe('HTTPS');
  });

  it('toggles rejectUnauthorized in the tls bag', () => {
    renderForm(HttpDestinationForm as unknown as FormLike, {
      scheme: 'HTTPS', tls: { caCertId: '', clientCertId: '', rejectUnauthorized: true },
    });

    fireEvent.click(screen.getByLabelText('Reject unauthorized certificates'));
    expect(tls()['rejectUnauthorized']).toBe(false);
  });

  it('does not render any raw PEM textareas', () => {
    renderForm(HttpDestinationForm as unknown as FormLike, { scheme: 'HTTPS', tls: {} });
    expect(screen.queryByLabelText(/PEM/i)).toBeNull();
  });
});

describe('HttpSourceForm — HTTPS mode', () => {
  it('hides certificate pickers in HTTP mode', () => {
    renderForm(HttpSourceForm as unknown as FormLike, { scheme: 'HTTP', tls: {} });
    expect(screen.queryByLabelText('Server certificate')).toBeNull();
  });

  it('shows a required server-cert picker with an error when empty in HTTPS mode', () => {
    renderForm(HttpSourceForm as unknown as FormLike, { scheme: 'HTTP', tls: {} });

    selectOption('Mode', 'HTTPS');

    expect(lastProps['scheme']).toBe('HTTPS');
    const serverPicker = screen.getByLabelText(/Server certificate/);
    expect(serverPicker).toBeTruthy();
    // required + empty => aria-invalid on the input
    expect(serverPicker.getAttribute('aria-invalid')).toBe('true');
  });

  it('writes tls.serverCertId (id reference) when a server cert is picked', () => {
    renderForm(HttpSourceForm as unknown as FormLike, {
      scheme: 'HTTPS', tls: { serverCertId: '', caCertId: '', requireClientCert: false },
    });

    pickCert(/Server certificate/, /Listener Cert/);

    expect(tls()['serverCertId']).toBe('srv-1');
  });

  it('toggles requireClientCert in the tls bag', () => {
    renderForm(HttpSourceForm as unknown as FormLike, {
      scheme: 'HTTPS', tls: { serverCertId: 'srv-1', caCertId: '', requireClientCert: false },
    });

    fireEvent.click(screen.getByLabelText('Require client certificate'));
    expect(tls()['requireClientCert']).toBe(true);
  });

  it('offers only CA-typed certs in the Trust CA picker', () => {
    renderForm(HttpSourceForm as unknown as FormLike, {
      scheme: 'HTTPS', tls: { serverCertId: 'srv-1', caCertId: '', requireClientCert: false },
    });

    const input = screen.getByLabelText('Trust CA');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Internal CA')).toBeTruthy();
    expect(within(listbox).queryByText('Client Cert')).toBeNull();
  });
});
