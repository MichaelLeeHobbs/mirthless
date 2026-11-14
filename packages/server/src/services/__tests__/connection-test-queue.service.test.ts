// ===========================================
// Connection Test Service: Kafka and AMQP
// ===========================================
// The broker checks themselves (testKafkaConnection, testAmqpConnection) run
// against real brokers in the connectors integration suite; here they are
// replaced so the tester's own work is checked: schema validation, the SSRF
// guard on every broker host, certificate resolution, and how a broker
// failure is reported.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetMaterialById = vi.fn();
vi.mock('../certificate.service.js', () => ({
  CertificateService: { getMaterialById: (...args: unknown[]) => mockGetMaterialById(...args) },
}));

const mockDnsLookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockDnsLookup(...args),
}));

const mockTestKafka = vi.fn();
const mockTestAmqp = vi.fn();
vi.mock('@galvaniflow/connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@galvaniflow/connectors')>()),
  testKafkaConnection: (...args: unknown[]) => mockTestKafka(...args),
  testAmqpConnection: (...args: unknown[]) => mockTestAmqp(...args),
}));

const { ConnectionTestService } = await import('../connection-test.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockTestKafka.mockResolvedValue('Connected to Kafka cluster c1');
  mockTestAmqp.mockResolvedValue('Connected to rabbit:5672');
});

describe('KAFKA', () => {
  const source = { brokers: 'kafka-1.example.com:9093,kafka-2.example.com:9093', topic: 'adt', groupId: 'g' };

  it('checks the brokers and the source topic, and reports success', async () => {
    const result = await ConnectionTestService.testConnection('KAFKA', 'SOURCE', source);
    expect(result.ok && result.value.success).toBe(true);
    expect(mockDnsLookup).toHaveBeenCalledTimes(2);
    expect(mockTestKafka).toHaveBeenCalledWith(expect.objectContaining({ brokers: source.brokers, tls: undefined }), 'adt');
  });

  it('skips the topic check for a destination whose topic varies per message', async () => {
    await ConnectionTestService.testConnection('KAFKA', 'DESTINATION', { brokers: 'k.example.com:9092', topic: 'out-${site}' });
    expect(mockTestKafka).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it('passes resolved PEM, not certificate ids, when TLS is on', async () => {
    mockGetMaterialById.mockResolvedValueOnce({ ok: true, value: { certificatePem: 'CA-PEM', privateKeyPem: null }, error: null });
    await ConnectionTestService.testConnection('KAFKA', 'SOURCE', { ...source, useTls: true, tls: { caCertId: 'ca-1' } });
    expect(mockTestKafka.mock.calls[0]?.[0]).toMatchObject({ tls: { ca: 'CA-PEM', rejectUnauthorized: true } });
  });

  it('blocks a broker on a private address, even when it is not the first', async () => {
    const result = await ConnectionTestService.testConnection('KAFKA', 'SOURCE', { ...source, brokers: 'kafka-1.example.com:9093,10.0.0.5:9093' });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('10.0.0.5');
    expect(mockTestKafka).not.toHaveBeenCalled();
  });

  it('rejects invalid properties before connecting', async () => {
    const result = await ConnectionTestService.testConnection('KAFKA', 'SOURCE', { brokers: 'k.example.com:9092', topic: 'adt' });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('groupId');
    expect(mockTestKafka).not.toHaveBeenCalled();
  });

  it('reports a broker failure as a failed test, not an error', async () => {
    mockTestKafka.mockRejectedValueOnce(new Error('SASL authentication failed'));
    const result = await ConnectionTestService.testConnection('KAFKA', 'SOURCE', source);
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ success: false, message: 'Kafka connection failed: SASL authentication failed' });
  });
});

describe('AMQP', () => {
  it('checks the source queue', async () => {
    const result = await ConnectionTestService.testConnection('AMQP', 'SOURCE', { host: 'rabbit.example.com', queue: 'adt' });
    expect(result.ok && result.value.success).toBe(true);
    expect(mockTestAmqp).toHaveBeenCalledWith(expect.objectContaining({ host: 'rabbit.example.com', port: 5672 }), { queue: 'adt' });
  });

  it('checks the destination exchange', async () => {
    await ConnectionTestService.testConnection('AMQP', 'DESTINATION', { host: 'rabbit.example.com', exchange: 'hl7', routingKey: 'x' });
    expect(mockTestAmqp).toHaveBeenCalledWith(expect.anything(), { exchange: 'hl7' });
  });

  it('blocks a broker on a loopback address', async () => {
    const result = await ConnectionTestService.testConnection('AMQP', 'SOURCE', { host: '127.0.0.1', queue: 'adt' });
    expect(result.ok).toBe(false);
    expect(mockTestAmqp).not.toHaveBeenCalled();
  });

  it('reports a missing queue as a failed test', async () => {
    mockTestAmqp.mockRejectedValueOnce(new Error('NOT_FOUND - no queue \'adt\''));
    const result = await ConnectionTestService.testConnection('AMQP', 'SOURCE', { host: 'rabbit.example.com', queue: 'adt' });
    expect(result.value).toMatchObject({ success: false });
    expect(result.value?.message).toContain('no queue');
  });

  it('fails loud when a referenced certificate cannot be resolved', async () => {
    mockGetMaterialById.mockResolvedValueOnce({ ok: false, value: null, error: { message: 'Certificate ca-9 not found' } });
    const result = await ConnectionTestService.testConnection('AMQP', 'SOURCE', { host: 'rabbit.example.com', queue: 'adt', useTls: true, tls: { caCertId: 'ca-9' } });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('ca-9');
  });
});
