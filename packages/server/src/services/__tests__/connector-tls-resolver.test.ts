import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetMaterialById = vi.fn();

vi.mock('../certificate.service.js', () => ({
  CertificateService: { getMaterialById: (...args: unknown[]) => mockGetMaterialById(...args) },
}));

const { resolveHttpDestinationTls, resolveHttpSourceTls, resolveQueueTls, privateKeyCertificateIds, assertCertificatesInScope } = await import('../connector-tls-resolver.js');

function okMaterial(certificatePem: string, privateKeyPem: string | null): unknown {
  return { ok: true, value: { certificatePem, privateKeyPem }, error: null };
}

function notFound(id: string): unknown {
  return { ok: false, value: null, error: { message: `Certificate ${id} not found` } };
}

const CA_ID = 'ca-1';
const CLIENT_ID = 'client-1';
const SERVER_ID = 'server-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveHttpDestinationTls', () => {
  it('passes props through unchanged for plain HTTP (no cert lookups)', async () => {
    const props = { scheme: 'HTTP', url: 'http://example.com', method: 'POST' };

    const result = await resolveHttpDestinationTls(props);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(props);
    expect(mockGetMaterialById).not.toHaveBeenCalled();
  });

  it('passes through when scheme is absent (legacy props)', async () => {
    const props = { url: 'http://example.com' };

    const result = await resolveHttpDestinationTls(props);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(props);
    expect(mockGetMaterialById).not.toHaveBeenCalled();
  });

  it('resolves a CA reference into a ca PEM (rejectUnauthorized defaults true)', async () => {
    mockGetMaterialById.mockResolvedValueOnce(okMaterial('CA-PEM', null));
    const props = { scheme: 'HTTPS', url: 'https://x', tls: { caCertId: CA_ID } };

    const result = await resolveHttpDestinationTls(props);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['tls']).toEqual({ rejectUnauthorized: true, ca: 'CA-PEM' });
  });

  it('resolves a client cert into cert+key for mutual TLS', async () => {
    mockGetMaterialById.mockResolvedValueOnce(okMaterial('CLIENT-CERT', 'CLIENT-KEY'));
    const props = { scheme: 'HTTPS', url: 'https://x', tls: { clientCertId: CLIENT_ID, rejectUnauthorized: false } };

    const result = await resolveHttpDestinationTls(props);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['tls']).toEqual({ rejectUnauthorized: false, cert: 'CLIENT-CERT', key: 'CLIENT-KEY' });
  });

  it('fails loud when a referenced id does not resolve', async () => {
    mockGetMaterialById.mockResolvedValueOnce(notFound(CA_ID));
    const props = { scheme: 'HTTPS', url: 'https://x', tls: { caCertId: CA_ID } };

    const result = await resolveHttpDestinationTls(props);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(CA_ID);
  });

  it('fails loud when the selected client cert has no private key', async () => {
    mockGetMaterialById.mockResolvedValueOnce(okMaterial('CLIENT-CERT', null));
    const props = { scheme: 'HTTPS', url: 'https://x', tls: { clientCertId: CLIENT_ID } };

    const result = await resolveHttpDestinationTls(props);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('no private key');
  });
});

describe('resolveHttpSourceTls', () => {
  it('passes props through unchanged for plain HTTP', async () => {
    const props = { scheme: 'HTTP', port: 8080, path: '/' };

    const result = await resolveHttpSourceTls(props);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(props);
    expect(mockGetMaterialById).not.toHaveBeenCalled();
  });

  it('resolves the server cert into cert+key (requireClientCert defaults false)', async () => {
    mockGetMaterialById.mockResolvedValueOnce(okMaterial('SRV-CERT', 'SRV-KEY'));
    const props = { scheme: 'HTTPS', port: 8443, tls: { serverCertId: SERVER_ID } };

    const result = await resolveHttpSourceTls(props);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['tls']).toEqual({ cert: 'SRV-CERT', key: 'SRV-KEY', requireClientCert: false });
  });

  it('resolves an optional CA and honors requireClientCert (mTLS)', async () => {
    mockGetMaterialById
      .mockResolvedValueOnce(okMaterial('SRV-CERT', 'SRV-KEY'))
      .mockResolvedValueOnce(okMaterial('CA-PEM', null));
    const props = { scheme: 'HTTPS', port: 8443, tls: { serverCertId: SERVER_ID, caCertId: CA_ID, requireClientCert: true } };

    const result = await resolveHttpSourceTls(props);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['tls']).toEqual({ cert: 'SRV-CERT', key: 'SRV-KEY', requireClientCert: true, ca: 'CA-PEM' });
  });

  it('fails loud when serverCertId is missing', async () => {
    const props = { scheme: 'HTTPS', port: 8443, tls: { requireClientCert: true } };

    const result = await resolveHttpSourceTls(props);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('serverCertId');
    expect(mockGetMaterialById).not.toHaveBeenCalled();
  });

  it('fails loud when the server cert has no private key', async () => {
    mockGetMaterialById.mockResolvedValueOnce(okMaterial('SRV-CERT', null));
    const props = { scheme: 'HTTPS', port: 8443, tls: { serverCertId: SERVER_ID } };

    const result = await resolveHttpSourceTls(props);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('no private key');
  });

  it('fails loud when the referenced server id does not resolve', async () => {
    mockGetMaterialById.mockResolvedValueOnce(notFound(SERVER_ID));
    const props = { scheme: 'HTTPS', port: 8443, tls: { serverCertId: SERVER_ID } };

    const result = await resolveHttpSourceTls(props);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(SERVER_ID);
  });
});

describe('resolveQueueTls', () => {
  it('passes props through unchanged when useTls is off, even with ids in the bag', async () => {
    const props = { host: 'rabbit', useTls: false, tls: { caCertId: CA_ID } };
    const result = await resolveQueueTls(props);
    expect(result.ok && result.value).toEqual(props);
    expect(mockGetMaterialById).not.toHaveBeenCalled();
  });

  it('resolves CA and client certificate ids to PEM when useTls is on', async () => {
    mockGetMaterialById
      .mockResolvedValueOnce(okMaterial('CA-PEM', null))
      .mockResolvedValueOnce(okMaterial('CLIENT-PEM', 'CLIENT-KEY'));
    const result = await resolveQueueTls({ brokers: 'k:9093', useTls: true, tls: { caCertId: CA_ID, clientCertId: CLIENT_ID, rejectUnauthorized: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['tls']).toEqual({ rejectUnauthorized: true, ca: 'CA-PEM', cert: 'CLIENT-PEM', key: 'CLIENT-KEY' });
  });

  it('verifies the broker with the system CAs when no CA is chosen', async () => {
    const result = await resolveQueueTls({ useTls: true });
    expect(result.ok && result.value['tls']).toEqual({ rejectUnauthorized: true });
  });

  it('fails loud when a referenced certificate is missing', async () => {
    mockGetMaterialById.mockResolvedValueOnce(notFound(CA_ID));
    const result = await resolveQueueTls({ useTls: true, tls: { caCertId: CA_ID } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(CA_ID);
  });
});

describe('reading the stored tls bag', () => {
  const unusable: ReadonlyArray<readonly [string, unknown]> = [
    ['absent', undefined],
    ['null', null],
    ['false', false],
    ['an empty object', {}],
    ['a bag of PEM fields instead of ids', { cert: 'C', key: 'K' }],
  ];
  const junk: ReadonlyArray<readonly [string, unknown]> = [
    ['a string', 'abc'],
    ['an array', []],
    ['a number', 1],
    // D-277: tls: true once deployed as an empty bag; it now fails the deploy.
    ['the boolean true', true],
    ['the text "true"', 'true'],
  ];

  it.each(junk)('fails an HTTPS destination when tls is %s', async (_label, tls) => {
    const result = await resolveHttpDestinationTls({ scheme: 'HTTPS', url: 'https://x', tls });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Connector tls settings must be an object');
  });

  it.each(junk)('fails an HTTPS source when tls is %s', async (_label, tls) => {
    const result = await resolveHttpSourceTls({ scheme: 'HTTPS', port: 8443, tls });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Connector tls settings must be an object');
  });

  it('fails a queue connector with useTls on when tls is a string', async () => {
    const result = await resolveQueueTls({ useTls: true, tls: 'abc' });
    expect(result.ok).toBe(false);
  });

  it.each(unusable)('resolves a client with no certificates and verification on when tls is %s', async (_label, tls) => {
    const result = await resolveHttpDestinationTls({ scheme: 'HTTPS', url: 'https://x', tls });
    expect(result.ok && result.value['tls']).toEqual({ rejectUnauthorized: true });
    expect(mockGetMaterialById).not.toHaveBeenCalled();
  });

  it.each(unusable)('fails an HTTPS source for a missing serverCertId when tls is %s', async (_label, tls) => {
    const result = await resolveHttpSourceTls({ scheme: 'HTTPS', port: 8443, tls });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('serverCertId');
  });

  it('keeps rejectUnauthorized: false from the bag', async () => {
    const result = await resolveQueueTls({ useTls: true, tls: { rejectUnauthorized: false } });
    expect(result.ok && result.value['tls']).toEqual({ rejectUnauthorized: false });
  });

  it('ignores extra keys in the bag', async () => {
    mockGetMaterialById.mockResolvedValueOnce(okMaterial('CA-PEM', null));
    const result = await resolveHttpDestinationTls({ scheme: 'HTTPS', url: 'https://x', tls: { caCertId: CA_ID, cert: 'C', note: 'x' } });
    expect(result.ok && result.value['tls']).toEqual({ rejectUnauthorized: true, ca: 'CA-PEM' });
  });
});

describe('privateKeyCertificateIds', () => {
  it('names the client and server certificates, once each, and never a CA', () => {
    expect(privateKeyCertificateIds({ tls: { clientCertId: 'c1', serverCertId: 'c1', caCertId: 'ca' } })).toEqual(['c1']);
    expect(privateKeyCertificateIds({ tls: { serverCertId: 's1', clientCertId: 'c1' } })).toEqual(['c1', 's1']);
  });

  it('names nothing for properties without a tls bag, or that are not an object', () => {
    expect(privateKeyCertificateIds({})).toEqual([]);
    expect(privateKeyCertificateIds(null)).toEqual([]);
    expect(privateKeyCertificateIds({ tls: { clientCertId: '' } })).toEqual([]);
  });

  // A DATABASE connector's tls is a switch. The resolvers refuse any of these on a connector that reads a bag (D-277).
  it.each([[true], ['yes'], [1], [['c1']]])('names nothing for a tls that is %j', (tls) => {
    expect(privateKeyCertificateIds({ tls })).toEqual([]);
  });
});

// What a save, an import and Test Connection all ask.
describe('assertCertificatesInScope', () => {
  it('lets a connector whose tls is a switch through, for a caller with no channels of their own', async () => {
    await expect(assertCertificatesInScope(undefined, 'channels:write', [{ host: 'db', tls: true }, { tls: false }])).resolves.toBeUndefined();
  });

  it('still refuses a certificate beside it', async () => {
    await expect(assertCertificatesInScope(undefined, 'channels:write', [{ host: 'db', tls: true }, { tls: { clientCertId: 'c1' } }]))
      .rejects.toThrow('can be used only where the channels in your access already use it');
  });
});
