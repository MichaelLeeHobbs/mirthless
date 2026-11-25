// An HTTPS destination's test: what reaches the request, which is replaced here.

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetMaterialById = vi.fn();
vi.mock('../certificate.service.js', () => ({
  CertificateService: { getMaterialById: (...args: unknown[]) => mockGetMaterialById(...args) },
}));

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));

type Answer = { readonly statusCode: number; readonly statusMessage: string; readonly headers: Readonly<Record<string, string>> };
let answer: Answer;
const mockRequest = vi.fn((_url: string, _options: Record<string, unknown>, onAnswer: (res: Answer & { resume: () => void }) => void) => {
  const req = Object.assign(new EventEmitter(), { end: () => { onAnswer({ ...answer, resume: () => undefined }); } });
  return req;
});
vi.mock('node:https', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:https')>()),
  request: (...args: Parameters<typeof mockRequest>) => mockRequest(...args),
}));

const { ConnectionTestService } = await import('../connection-test.service.js');

const PEM: Readonly<Record<string, object>> = {
  'ca-1': { certificatePem: 'CA-PEM', privateKeyPem: null },
  'client-1': { certificatePem: 'CERT-PEM', privateKeyPem: 'KEY-PEM' },
};

const test = (properties: object): ReturnType<typeof ConnectionTestService.testConnection> =>
  ConnectionTestService.testConnection('HTTP', 'DESTINATION', { url: 'https://partner.example.com/api', scheme: 'HTTPS', ...properties });

beforeEach(() => {
  vi.clearAllMocks();
  answer = { statusCode: 200, statusMessage: 'OK', headers: {} };
  mockGetMaterialById.mockImplementation((id: string) => Promise.resolve({ ok: true, value: PEM[id], error: null }));
});

describe('an HTTPS destination', () => {
  it('is tested with the certificates it deploys with', async () => {
    const result = await test({ tls: { caCertId: 'ca-1', clientCertId: 'client-1', rejectUnauthorized: true } });

    expect(result.value).toMatchObject({ success: true, message: 'HTTPS 200 OK' });
    expect(mockRequest).toHaveBeenCalledExactlyOnceWith(
      'https://partner.example.com/api',
      expect.objectContaining({ ca: 'CA-PEM', cert: 'CERT-PEM', key: 'KEY-PEM', rejectUnauthorized: true }),
      expect.anything(),
    );
  });

  it.each([
    [undefined, true],
    [true, true],
    [false, false],
  ])('checks the server certificate as it is set to: %s', async (rejectUnauthorized, checked) => {
    await test({ tls: { caCertId: 'ca-1', ...(rejectUnauthorized === undefined ? {} : { rejectUnauthorized }) } });

    expect(mockRequest.mock.calls[0]?.[1]).toMatchObject({ rejectUnauthorized: checked });
  });

  it('fails on a redirect, which the destination does not follow', async () => {
    answer = { statusCode: 302, statusMessage: 'Found', headers: { location: 'http://169.254.169.254/' } };

    const result = await test({ tls: { caCertId: 'ca-1' } });

    expect(result.value).toMatchObject({ success: false });
    expect(result.value?.message).toContain('HTTP 302: the server redirected');
    expect(mockRequest).toHaveBeenCalledOnce();
  });

  it.each([400, 500])('reports the HTTP status %i of a server that answers', async (statusCode) => {
    answer = { statusCode, statusMessage: 'Said no', headers: {} };
    expect((await test({ tls: { caCertId: 'ca-1' } })).value?.message).toBe(`HTTPS ${String(statusCode)} Said no`);
  });
});
