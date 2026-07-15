// ===========================================
// Connector TLS Resolver Tests
// ===========================================
// Verifies id->PEM resolution for HTTP source/destination connectors:
// HTTP passthrough, HTTPS ca/client/server resolution, and fail-loud behavior
// on missing ids or certs selected for a key-requiring role without a key.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetMaterialById = vi.fn();

vi.mock('../certificate.service.js', () => ({
  CertificateService: { getMaterialById: (...args: unknown[]) => mockGetMaterialById(...args) },
}));

const { resolveHttpDestinationTls, resolveHttpSourceTls } = await import('../connector-tls-resolver.js');

// ----- Helpers -----

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

// ----- Destination -----

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

// ----- Source -----

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
