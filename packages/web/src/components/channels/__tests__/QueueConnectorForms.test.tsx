// ===========================================
// Kafka and AMQP Connector Form Tests
// ===========================================
// The forms start from defaults the core-models schemas accept unchanged,
// write the id-based tls shape the server resolves, and show SASL and TLS
// fields only when they apply.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactElement, type ReactNode } from 'react';
import {
  kafkaSourcePropertiesSchema,
  kafkaDestinationPropertiesSchema,
  amqpSourcePropertiesSchema,
  amqpDestinationPropertiesSchema,
} from '@galvaniflow/core-models';
import { darkTheme } from '../../../styles/theme.js';
import { KAFKA_SOURCE_DEFAULTS, AMQP_SOURCE_DEFAULTS, getDefaultProperties } from '../source/connector-defaults.js';
import { KAFKA_DEST_DEFAULTS, AMQP_DEST_DEFAULTS, getDestDefaultProperties } from '../destinations/connector-defaults.js';

const CERTS = [
  { id: 'ca-1', name: 'Internal CA', type: 'CA', notAfter: '2099-01-01T00:00:00.000Z', hasPrivateKey: false },
  { id: 'cli-1', name: 'Client Cert', type: 'CLIENT', notAfter: '2099-01-01T00:00:00.000Z', hasPrivateKey: true },
];
vi.mock('../../../hooks/use-certificates.js', () => ({
  useCertificates: (query?: { type?: string }) => ({
    data: CERTS.filter((c) => !query?.type || c.type === query.type),
    isLoading: false,
  }),
}));
vi.mock('../../common/TestConnectionButton.js', () => ({
  TestConnectionButton: ({ connectorType, mode }: { connectorType: string; mode: string }) => <span>{`test ${connectorType} ${mode}`}</span>,
}));

import { KafkaSourceForm } from '../source/KafkaSourceForm.js';
import { AmqpSourceForm } from '../source/AmqpSourceForm.js';
import { KafkaDestinationForm } from '../destinations/KafkaDestinationForm.js';
import { AmqpDestinationForm } from '../destinations/AmqpDestinationForm.js';

type FormLike = (props: { properties: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) => ReactNode;

let lastProps: Record<string, unknown> = {};

function Harness({ Form, initial }: { Form: FormLike; initial: Record<string, unknown> }): ReactElement {
  const [props, setProps] = useState<Record<string, unknown>>(initial);
  lastProps = props;
  return <Form properties={props} onChange={(p) => { setProps(p); lastProps = p; }} />;
}

function renderForm(Form: FormLike, initial: Record<string, unknown> = {}): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={darkTheme}>
        <Harness Form={Form} initial={initial} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function selectOption(triggerLabel: string, optionName: string): void {
  fireEvent.mouseDown(screen.getByLabelText(triggerLabel));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: optionName }));
}

afterEach(() => {
  cleanup();
  lastProps = {};
});

describe('defaults', () => {
  // Filling only the required fields, the schema must return the defaults unchanged:
  // same keys (it strips unknown ones) and the same default values.
  it.each([
    ['Kafka source', kafkaSourcePropertiesSchema, KAFKA_SOURCE_DEFAULTS, { brokers: 'k:9092', topic: 't', groupId: 'g' }],
    ['Kafka destination', kafkaDestinationPropertiesSchema, KAFKA_DEST_DEFAULTS, { brokers: 'k:9092', topic: 't' }],
    ['AMQP source', amqpSourcePropertiesSchema, AMQP_SOURCE_DEFAULTS, { host: 'rabbit', queue: 'q' }],
    ['AMQP destination', amqpDestinationPropertiesSchema, AMQP_DEST_DEFAULTS, { host: 'rabbit', routingKey: 'q' }],
  ] as const)('%s defaults match the core-models schema', (_name, schema, defaults, required) => {
    const filled = { ...defaults, ...required };
    expect(schema.parse(filled)).toEqual(filled);
  });

  it('are what the editor hands a new connector of each type', () => {
    expect(getDefaultProperties('KAFKA')).toEqual(KAFKA_SOURCE_DEFAULTS);
    expect(getDefaultProperties('AMQP')).toEqual(AMQP_SOURCE_DEFAULTS);
    expect(getDestDefaultProperties('KAFKA')).toEqual(KAFKA_DEST_DEFAULTS);
    expect(getDestDefaultProperties('AMQP')).toEqual(AMQP_DEST_DEFAULTS);
  });
});

describe('KafkaSourceForm', () => {
  it('fills an empty connector with the defaults and offers a source connection test', () => {
    renderForm(KafkaSourceForm);
    expect(lastProps).toEqual(KAFKA_SOURCE_DEFAULTS);
    expect(screen.getByText('test KAFKA SOURCE')).toBeTruthy();
  });

  it('shows SASL credentials only once a mechanism is chosen', () => {
    renderForm(KafkaSourceForm, { ...KAFKA_SOURCE_DEFAULTS });
    expect(screen.queryByLabelText('SASL Username')).toBeNull();
    selectOption('SASL Mechanism', 'SCRAM-SHA-512');
    fireEvent.change(screen.getByLabelText('SASL Username'), { target: { value: 'svc-galvaniflow' } });
    expect(lastProps).toMatchObject({ saslMechanism: 'SCRAM-SHA-512', saslUsername: 'svc-galvaniflow' });
  });

  it('writes topic, group and start position', () => {
    renderForm(KafkaSourceForm, { ...KAFKA_SOURCE_DEFAULTS });
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'adt' } });
    fireEvent.change(screen.getByLabelText('Consumer Group'), { target: { value: 'galvaniflow-adt' } });
    selectOption('Start From', 'Latest (only new records)');
    expect(lastProps).toMatchObject({ topic: 'adt', groupId: 'galvaniflow-adt', startFrom: 'LATEST' });
  });
});

describe('TLS fields', () => {
  it('appear when TLS is on and store certificate ids, not PEM', () => {
    renderForm(AmqpSourceForm, { ...AMQP_SOURCE_DEFAULTS });
    expect(screen.queryByLabelText('Trust CA')).toBeNull();
    fireEvent.click(screen.getByLabelText('Use TLS'));
    const picker = screen.getByLabelText('Trust CA');
    picker.focus();
    fireEvent.keyDown(picker, { key: 'ArrowDown' });
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Internal CA'));
    expect(lastProps['useTls']).toBe(true);
    expect(lastProps['tls']).toEqual({ caCertId: 'ca-1', clientCertId: '', rejectUnauthorized: true });
  });
});

describe('AmqpSourceForm', () => {
  it('writes connection and queue', () => {
    renderForm(AmqpSourceForm);
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'rabbit.internal' } });
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '5671' } });
    fireEvent.change(screen.getByLabelText('Queue'), { target: { value: 'adt-in' } });
    expect(lastProps).toMatchObject({ host: 'rabbit.internal', port: 5671, queue: 'adt-in', vhost: '/' });
    expect(screen.getByText('test AMQP SOURCE')).toBeTruthy();
  });
});

describe('KafkaDestinationForm', () => {
  it('writes topic and key templates', () => {
    renderForm(KafkaDestinationForm);
    expect(lastProps).toEqual(KAFKA_DEST_DEFAULTS);
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'results-${site}' } });
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: '${patientId}' } });
    expect(lastProps).toMatchObject({ topic: 'results-${site}', key: '${patientId}' });
    expect(screen.getByText('test KAFKA DESTINATION')).toBeTruthy();
  });
});

describe('AmqpDestinationForm', () => {
  it('writes exchange, routing key and content type', () => {
    renderForm(AmqpDestinationForm);
    expect(lastProps).toEqual(AMQP_DEST_DEFAULTS);
    fireEvent.change(screen.getByLabelText('Exchange'), { target: { value: 'hl7' } });
    fireEvent.change(screen.getByLabelText('Routing Key'), { target: { value: 'adt.${event}' } });
    fireEvent.change(screen.getByLabelText('Content Type'), { target: { value: 'application/hl7-v2' } });
    expect(lastProps).toMatchObject({ exchange: 'hl7', routingKey: 'adt.${event}', contentType: 'application/hl7-v2' });
  });
});
