// ===========================================
// Connector Runtime-Option Form Tests (rank-4 surfacing)
// ===========================================
// Verifies the newly surfaced runtime options render, toggle/select, and write
// the exact prop keys the connector registry reads:
//   TCP source: responseMode, charset, maxFrameBytes
//   TCP dest:   acquireTimeoutMs, charset
//   HTTP source: errorStatusCode, maxBodyBytes
//   SMTP dest:  requireTLS

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';

// Mock TestConnectionButton — it pulls in socket/query wiring irrelevant here.
vi.mock('../../common/TestConnectionButton.js', () => ({
  TestConnectionButton: () => null,
}));

// Mock the certificate list hook (HttpSourceForm imports CertificateSelect).
vi.mock('../../../hooks/use-certificates.js', () => ({
  useCertificates: () => ({ data: [], isLoading: false }),
}));

import { TcpMllpSourceForm } from '../source/TcpMllpSourceForm.js';
import { TcpMllpDestinationForm } from '../destinations/TcpMllpDestinationForm.js';
import { HttpSourceForm } from '../source/HttpSourceForm.js';
import { SmtpDestinationForm } from '../destinations/SmtpDestinationForm.js';

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

/** Open an MUI TextField-select and click the option with the given label. */
function selectOption(triggerLabel: string, optionName: string | RegExp): void {
  fireEvent.mouseDown(screen.getByLabelText(triggerLabel));
  const listbox = screen.getByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: optionName }));
}

function typeNumber(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(() => { cleanup(); lastProps = {}; });

describe('TcpMllpSourceForm — MLLP runtime options', () => {
  it('renders the response mode, charset, and max frame controls', () => {
    renderForm(TcpMllpSourceForm as unknown as FormLike, { ...{}, responseMode: 'AUTO_ACK', charset: 'utf-8', maxFrameBytes: 52428800 });
    expect(screen.getByLabelText('Response Mode')).toBeTruthy();
    expect(screen.getByLabelText('Charset')).toBeTruthy();
    expect(screen.getByLabelText('Max Frame Bytes')).toBeTruthy();
  });

  it('writes responseMode=PASSTHROUGH when selected', () => {
    renderForm(TcpMllpSourceForm as unknown as FormLike, { responseMode: 'AUTO_ACK', charset: 'utf-8', maxFrameBytes: 52428800 });
    selectOption('Response Mode', /Passthrough/);
    expect(lastProps['responseMode']).toBe('PASSTHROUGH');
  });

  it('writes a valid Node encoding token for charset', () => {
    renderForm(TcpMllpSourceForm as unknown as FormLike, { responseMode: 'AUTO_ACK', charset: 'utf-8', maxFrameBytes: 52428800 });
    selectOption('Charset', 'ISO-8859-1 (Latin-1)');
    expect(lastProps['charset']).toBe('latin1');
  });

  it('writes maxFrameBytes as a number', () => {
    renderForm(TcpMllpSourceForm as unknown as FormLike, { responseMode: 'AUTO_ACK', charset: 'utf-8', maxFrameBytes: 52428800 });
    typeNumber('Max Frame Bytes', '1048576');
    expect(lastProps['maxFrameBytes']).toBe(1048576);
  });
});

describe('TcpMllpDestinationForm — runtime options', () => {
  it('renders the acquire-timeout and charset controls', () => {
    renderForm(TcpMllpDestinationForm as unknown as FormLike, { acquireTimeoutMs: 30000, charset: 'utf-8' });
    expect(screen.getByLabelText('Acquire Timeout (ms)')).toBeTruthy();
    expect(screen.getByLabelText('Charset')).toBeTruthy();
  });

  it('writes acquireTimeoutMs as a number', () => {
    renderForm(TcpMllpDestinationForm as unknown as FormLike, { acquireTimeoutMs: 30000, charset: 'utf-8' });
    typeNumber('Acquire Timeout (ms)', '5000');
    expect(lastProps['acquireTimeoutMs']).toBe(5000);
  });

  it('writes charset token when selected', () => {
    renderForm(TcpMllpDestinationForm as unknown as FormLike, { acquireTimeoutMs: 30000, charset: 'utf-8' });
    selectOption('Charset', 'US-ASCII');
    expect(lastProps['charset']).toBe('ascii');
  });
});

describe('HttpSourceForm — error/body-size options', () => {
  it('renders the error status and max-body controls', () => {
    renderForm(HttpSourceForm as unknown as FormLike, { scheme: 'HTTP', tls: {}, errorStatusCode: 500, maxBodyBytes: 52428800 });
    expect(screen.getByLabelText('Error Status Code')).toBeTruthy();
    expect(screen.getByLabelText('Max Body Bytes')).toBeTruthy();
  });

  it('writes errorStatusCode and maxBodyBytes as numbers', () => {
    renderForm(HttpSourceForm as unknown as FormLike, { scheme: 'HTTP', tls: {}, errorStatusCode: 500, maxBodyBytes: 52428800 });
    typeNumber('Error Status Code', '503');
    expect(lastProps['errorStatusCode']).toBe(503);
    typeNumber('Max Body Bytes', '1024');
    expect(lastProps['maxBodyBytes']).toBe(1024);
  });
});

describe('SmtpDestinationForm — requireTLS', () => {
  it('renders the Require STARTTLS switch and toggles requireTLS', () => {
    renderForm(SmtpDestinationForm as unknown as FormLike, { secure: false, requireTLS: false });
    const toggle = screen.getByLabelText('Require STARTTLS');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(lastProps['requireTLS']).toBe(true);
  });

  it('disables Require STARTTLS when Use TLS/SSL is on', () => {
    renderForm(SmtpDestinationForm as unknown as FormLike, { secure: true, requireTLS: false });
    expect((screen.getByLabelText('Require STARTTLS') as HTMLInputElement).disabled).toBe(true);
  });
});
