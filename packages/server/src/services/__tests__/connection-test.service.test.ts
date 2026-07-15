// ===========================================
// Connection Test Service Tests
// ===========================================

import { generateKeyPairSync } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The HTTPS-source handshake tester resolves the selected server cert via
// CertificateService.getMaterialById; mock it so no DB is touched. The real
// source resolver (id -> PEM) still runs, so this exercises the full path.
const mockGetMaterialById = vi.fn();
vi.mock('../certificate.service.js', () => ({
  CertificateService: { getMaterialById: (...args: unknown[]) => mockGetMaterialById(...args) },
}));

import {
  ConnectionTestService,
  setPoolFactory,
  setSmtpTransportFactory,
  resetFactories,
  _testing,
} from '../connection-test.service.js';

// ----- TLS fixtures (self-signed CN=localhost pair; test-only) -----

const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUfbslPxwZsvZjSNfAld+jrNGfqKEwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDcxMjE5NDk0M1oXDTM2MDcw
OTE5NDk0M1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAxcTrIpuHQubX02oTolebOWAmS51uYFrPk4hjSCIb3yAt
TCz7apPZNRWpTS/+OM2o9599hbniWWg4IYXydoyHFpiv59hq/xGerr3qyfkWIOA+
+JNyhYCOrvFviA5MRe/gVpYNivUUx0sW/8m469JQRd3Tf7RNZw1eInYsbWFhSJr2
ZlorZ7rqn3Y9REtD4KGlxq3TGVbqi54FySKg2Nk+cqHlNphghDsd4Ym4eej/gWCC
oernK4jApb8VybqBDL9Wvn1JjNalQIGB5ReAQxAWV89UJyzCotKS+vKC3sbBYD9m
Ta9V+fGKzIoD/bP0abFuH8Td47fiSFo3oNCyOX5KWwIDAQABo28wbTAdBgNVHQ4E
FgQUm+fBUl1pyhE95Nd98phW1yapAPcwHwYDVR0jBBgwFoAUm+fBUl1pyhE95Nd9
8phW1yapAPcwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBABv4jQaqtIjBSh38V0xEO35691x/t7PB
dmiGV1VasI9tS6qIIKumbTHmHIo0qGUS08kGGBFHvlhk0SRwevq8EC+fHIh6bQgk
0i3ubTpnT4qu/g0+de8nOkk+F1ZfjjVzS4/sNlZ3sc3mEpFxLqF4i4praCr8kkMH
SxRN0sAXGvYTPFr2ZR9p+V6nkZzNGGU3lmh/Y3cBtINSprO8qd0Zk5iwFuuKES0o
Efge++UoPlPxI7VbGWrTFp36oTdiMOFi24bqom60x+xLHwbUaOQe4DupFTlEppu7
Rk4CjgfP0xG1s1r+qO2YlGOscRMFgl7niNrPiZOIZSiDOcSDB9ZVszM=
-----END CERTIFICATE-----
`;

const TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDFxOsim4dC5tfT
ahOiV5s5YCZLnW5gWs+TiGNIIhvfIC1MLPtqk9k1FalNL/44zaj3n32FueJZaDgh
hfJ2jIcWmK/n2Gr/EZ6uverJ+RYg4D74k3KFgI6u8W+IDkxF7+BWlg2K9RTHSxb/
ybjr0lBF3dN/tE1nDV4idixtYWFImvZmWitnuuqfdj1ES0PgoaXGrdMZVuqLngXJ
IqDY2T5yoeU2mGCEOx3hibh56P+BYIKh6ucriMClvxXJuoEMv1a+fUmM1qVAgYHl
F4BDEBZXz1QnLMKi0pL68oLexsFgP2ZNr1X58YrMigP9s/RpsW4fxN3jt+JIWjeg
0LI5fkpbAgMBAAECggEAU59rCQwYSmqPcb5VpPxEDyOfrbNYm3dqc+hkiniZrmPN
o3sVp7/yRObu2ktjxCL5whJ3IdcyZTmTGmGn3waWjDBtmKvCui16GksFfvdKqwYG
ulamQtrT+hbuYOoiyCOgiRwTh+EPMyGGDQv/m/8moBQmvMXBQMS/O/UZ3foiB292
0Bcle+5OnvuItBTP6t1yMyJm1RPZCmraqZKx/SznaZb1tFMv3/plnCadscDhJhcV
VdENU/ICBeO30lXRkPeEZoyt4TQVeH5S3Ftus3GlESbX3OTRWIPUAFXOM0K4kk5V
xJlFkmjwkVSEb1isTGXagMmkX8Az4MRdtBpAkEIiIQKBgQD/p2dufRxH6YBMav6g
KnFs/R/oE+4po8KnO587hshKkROJ29kNdSDE9q5XN9Vkxw19gGXFYt2ZbB2zd0LG
4hofA6n+pto13RPa0IaKG0TvB6Kty7tryOVOODknGyqpw+q/pZg6gnJUcDQBhq9S
2yU6wLmqK6gkYb4hdEp5PuTgSwKBgQDGCXRozUfyyO8++ttlxcBbEv4ZEbVM3LK4
ciMcJ7ghjzjDGy4k50Pnk/gyAFKsr+uAghVd5ZvYhpioGQvagvPgrXKcWk4AlHnT
ScHUxQsMrmoJn8o6IscZzSycAYi/vJBKzTyahdbRiEpj37RYV+b56bU60c2UyCYq
cC9zf4yUMQKBgCEsX8d+hITwT62a1J+D4mP6FIHQ1D6i+Ucp/WeD/clvOdHRrUCJ
yk7Ek6rNm+sPyThXyNzsD0UxOklnWErmW+1aVFyu2fHTVhg2pr6U+0TpALr8jL1X
vCmCMihY5hhRS8zCeBZfhuZeCOGJ0IY32YTeLTlfoNnXtQwyQteoyZoxAoGADfB6
bioM52z3UiKMMOSzfnWexxr0/P0H4229RO0Sy+Ht5+XQ4K4anIFQ1gwpxZf4ZqpB
YMOZrasDsclZiT7wdZ8f0xuUI/xPeuzVJOndtj3MnvLNZDwwcYN8oVqGSqC2M12w
51uGXGdQfSkw44sEahDmPcaoxtEzxobxABs5RPECgYEAi5/+vzGFU9ILSnKAtyrl
z8TUGLdfPd3GIW0L25VlWaF7mXgJwASllxVdUNA7uamUhYkTcZDzzTZlLSVmyqCG
3w551Ct0uJJOcoExBq2PoC9fXq5Sd/VOVl8HqA/JRjdc0ny7ZS3+Q3sATaa/3/3g
5SMI9cA5l/ywszdyKLM6TZU=
-----END PRIVATE KEY-----
`;

// A different, valid key that does NOT match TEST_CERT_PEM (generated per run).
const MISMATCHED_KEY_PEM = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey;

// ----- Mocks -----

// Mock node:net for TCP tests. isIP is needed by the SSRF guard's host check.
const mockConnect = vi.fn();
vi.mock('node:net', () => ({
  connect: (...args: unknown[]) => mockConnect(...args),
  isIP: (value: string) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? 4 : 0),
}));

// Mock DNS so the SSRF guard resolves test hostnames to a public IP (allowed)
// without real network I/O.
const mockDnsLookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockDnsLookup(...args),
}));

// Mock node:fs/promises for File tests
const mockAccess = vi.fn();
vi.mock('node:fs/promises', () => ({
  default: { access: (...args: unknown[]) => mockAccess(...args) },
  access: (...args: unknown[]) => mockAccess(...args),
  constants: { R_OK: 4, W_OK: 2 },
}));

// Mock global fetch for HTTP and FHIR tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ----- DB/SMTP factory mocks -----

const mockPoolQuery = vi.fn();
const mockPoolEnd = vi.fn();

const mockTransportVerify = vi.fn();
const mockTransportClose = vi.fn();

// ----- Helpers -----

/** Create a fake socket event emitter for TCP mock. */
function createFakeSocket(outcome: 'connect' | 'error', errorMsg?: string): Record<string, unknown> {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const socket = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
      return socket;
    }),
    destroy: vi.fn(),
  };

  // net.connect callback is the second argument
  mockConnect.mockImplementation((_opts: unknown, connectCb?: () => void) => {
    if (outcome === 'connect') {
      setTimeout(() => connectCb?.(), 0);
    } else {
      setTimeout(() => handlers['error']?.(new Error(errorMsg ?? 'ECONNREFUSED')), 0);
    }
    return socket;
  });

  return socket;
}

// ----- Tests -----

describe('ConnectionTestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Inject mock factories for DATABASE and SMTP
    setPoolFactory(() => ({
      query: mockPoolQuery,
      end: mockPoolEnd,
    }));

    setSmtpTransportFactory(() => ({
      verify: mockTransportVerify,
      close: mockTransportClose,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetFactories();
  });

  // ----- TCP/MLLP -----

  describe('TCP_MLLP', () => {
    it('returns success when TCP connection succeeds', async () => {
      createFakeSocket('connect');

      const result = await ConnectionTestService.testConnection('TCP_MLLP', 'DESTINATION', {
        host: 'example.com',
        port: 6661,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.message).toContain('example.com:6661');
      expect(result.value.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns failure when TCP connection fails', async () => {
      createFakeSocket('error', 'ECONNREFUSED');

      const result = await ConnectionTestService.testConnection('TCP_MLLP', 'DESTINATION', {
        host: 'example.com',
        port: 6661,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
      expect(result.value.message).toContain('ECONNREFUSED');
    });

    it('returns error when host property is missing', async () => {
      const result = await ConnectionTestService.testConnection('TCP_MLLP', 'DESTINATION', {
        port: 6661,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
    });

    it('returns error when port property is missing', async () => {
      const result = await ConnectionTestService.testConnection('TCP_MLLP', 'DESTINATION', {
        host: 'example.com',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('port');
    });
  });

  // ----- HTTP -----

  describe('HTTP', () => {
    it('returns success when HTTP HEAD request succeeds', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200, statusText: 'OK' });

      const result = await ConnectionTestService.testConnection('HTTP', 'DESTINATION', {
        url: 'https://example.com/api',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.message).toContain('200');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({ method: 'HEAD' }),
      );
    });

    it('returns failure when HTTP request fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const result = await ConnectionTestService.testConnection('HTTP', 'DESTINATION', {
        url: 'https://example.com/api',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
      expect(result.value.message).toContain('fetch failed');
    });

    it('returns error when url property is missing', async () => {
      const result = await ConnectionTestService.testConnection('HTTP', 'DESTINATION', {});

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('url');
    });

    it('resolves the server cert and does a real TLS handshake for an HTTPS SOURCE', async () => {
      // scheme HTTPS + mode SOURCE resolves the selected server cert (by id) and
      // handshakes over loopback — a listener has no outbound url, so requiring
      // one (the old behavior) was wrong.
      mockGetMaterialById.mockResolvedValueOnce({
        ok: true, value: { certificatePem: TEST_CERT_PEM, privateKeyPem: TEST_KEY_PEM }, error: null,
      });

      const result = await ConnectionTestService.testConnection('HTTP', 'SOURCE', {
        scheme: 'HTTPS',
        port: 8443,
        tls: { serverCertId: 'srv-1', requireClientCert: false },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.message).toContain('handshake succeeded');
    });

    it('fails loud for an HTTPS SOURCE when the cert and key do not match', async () => {
      mockGetMaterialById.mockResolvedValueOnce({
        ok: true, value: { certificatePem: TEST_CERT_PEM, privateKeyPem: MISMATCHED_KEY_PEM }, error: null,
      });

      const result = await ConnectionTestService.testConnection('HTTP', 'SOURCE', {
        scheme: 'HTTPS',
        port: 8443,
        tls: { serverCertId: 'srv-1', requireClientCert: false },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
      expect(result.value.message).toContain('TLS handshake failed');
    });

    it('fails loud for an HTTPS SOURCE when the referenced cert cannot be resolved', async () => {
      mockGetMaterialById.mockResolvedValueOnce({
        ok: false, value: null, error: { message: 'Certificate srv-1 not found' },
      });

      const result = await ConnectionTestService.testConnection('HTTP', 'SOURCE', {
        scheme: 'HTTPS',
        port: 8443,
        tls: { serverCertId: 'srv-1', requireClientCert: false },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('resolution failed');
    });
  });

  // ----- FILE -----

  describe('FILE', () => {
    it('returns success when directory is accessible for SOURCE', async () => {
      mockAccess.mockResolvedValueOnce(undefined);

      const result = await ConnectionTestService.testConnection('FILE', 'SOURCE', {
        directory: '/data/in',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.message).toContain('/data/in');
    });

    it('returns success when directory is accessible for DESTINATION', async () => {
      mockAccess.mockResolvedValueOnce(undefined);

      const result = await ConnectionTestService.testConnection('FILE', 'DESTINATION', {
        directory: '/data/out',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
    });

    it('returns failure when directory is not accessible', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

      const result = await ConnectionTestService.testConnection('FILE', 'SOURCE', {
        directory: '/nonexistent',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
      expect(result.value.message).toContain('ENOENT');
    });

    it('returns error when directory property is missing', async () => {
      const result = await ConnectionTestService.testConnection('FILE', 'SOURCE', {});

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('directory');
    });
  });

  // ----- DATABASE -----

  describe('DATABASE', () => {
    it('returns success when SELECT 1 succeeds', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
      mockPoolEnd.mockResolvedValueOnce(undefined);

      const result = await ConnectionTestService.testConnection('DATABASE', 'SOURCE', {
        host: 'db.example.com',
        port: 5432,
        database: 'testdb',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.message).toContain('db.example.com');
    });

    it('returns failure when database connection fails', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('connection refused'));
      mockPoolEnd.mockResolvedValueOnce(undefined);

      const result = await ConnectionTestService.testConnection('DATABASE', 'SOURCE', {
        host: 'db.example.com',
        port: 5432,
        database: 'testdb',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
      expect(result.value.message).toContain('connection refused');
    });

    it('returns error when host property is missing', async () => {
      const result = await ConnectionTestService.testConnection('DATABASE', 'SOURCE', {
        port: 5432,
        database: 'testdb',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
    });

    it('always calls pool.end in finally block', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      mockPoolEnd.mockResolvedValueOnce(undefined);

      await ConnectionTestService.testConnection('DATABASE', 'SOURCE', {
        host: 'db.example.com',
        port: 5432,
        database: 'testdb',
      });

      expect(mockPoolEnd).toHaveBeenCalled();
    });
  });

  // ----- SMTP -----

  describe('SMTP', () => {
    it('returns success when SMTP verify succeeds', async () => {
      mockTransportVerify.mockResolvedValueOnce(true);

      const result = await ConnectionTestService.testConnection('SMTP', 'DESTINATION', {
        host: 'smtp.example.com',
        port: 587,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.message).toContain('smtp.example.com');
      expect(mockTransportClose).toHaveBeenCalled();
    });

    it('returns failure when SMTP verify fails', async () => {
      mockTransportVerify.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await ConnectionTestService.testConnection('SMTP', 'DESTINATION', {
        host: 'smtp.example.com',
        port: 587,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
      expect(result.value.message).toContain('ECONNREFUSED');
      expect(mockTransportClose).toHaveBeenCalled();
    });

    it('returns error when host property is missing', async () => {
      const result = await ConnectionTestService.testConnection('SMTP', 'DESTINATION', {
        port: 587,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
    });

    it('always calls transport.close in finally block', async () => {
      mockTransportVerify.mockResolvedValueOnce(true);

      await ConnectionTestService.testConnection('SMTP', 'DESTINATION', {
        host: 'smtp.example.com',
        port: 587,
      });

      expect(mockTransportClose).toHaveBeenCalled();
    });
  });

  // ----- FHIR -----

  describe('FHIR', () => {
    it('returns success when /metadata returns 200', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await ConnectionTestService.testConnection('FHIR', 'DESTINATION', {
        baseUrl: 'https://fhir.example.com/r4',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.message).toContain('200');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://fhir.example.com/r4/metadata',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/fhir+json' },
        }),
      );
    });

    it('returns failure when /metadata returns non-OK status', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await ConnectionTestService.testConnection('FHIR', 'DESTINATION', {
        baseUrl: 'https://fhir.example.com/r4',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
      expect(result.value.message).toContain('404');
    });

    it('returns failure when FHIR request throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const result = await ConnectionTestService.testConnection('FHIR', 'DESTINATION', {
        baseUrl: 'https://fhir.example.com/r4',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
      expect(result.value.message).toContain('network error');
    });

    it('returns error when baseUrl property is missing', async () => {
      const result = await ConnectionTestService.testConnection('FHIR', 'DESTINATION', {});

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('baseUrl');
    });

    it('strips trailing slashes from baseUrl before appending /metadata', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await ConnectionTestService.testConnection('FHIR', 'DESTINATION', {
        baseUrl: 'https://fhir.example.com/r4/',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://fhir.example.com/r4/metadata',
        expect.anything(),
      );
    });
  });

  // ----- DICOM -----

  describe('DICOM', () => {
    it('returns success when TCP connection to DICOM host succeeds', async () => {
      createFakeSocket('connect');

      const result = await ConnectionTestService.testConnection('DICOM', 'DESTINATION', {
        host: 'pacs.example.com',
        port: 104,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.message).toContain('pacs.example.com:104');
    });

    it('returns failure when DICOM TCP connection fails', async () => {
      createFakeSocket('error', 'ECONNREFUSED');

      const result = await ConnectionTestService.testConnection('DICOM', 'DESTINATION', {
        host: 'pacs.example.com',
        port: 104,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
    });
  });

  // ----- CHANNEL -----

  describe('CHANNEL', () => {
    it('returns immediate success for CHANNEL connector', async () => {
      const result = await ConnectionTestService.testConnection('CHANNEL', 'SOURCE', {
        channelId: 'abc-123',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.latencyMs).toBe(0);
      expect(result.value.message).toContain('internal');
    });
  });

  // ----- JAVASCRIPT -----

  describe('JAVASCRIPT', () => {
    it('returns immediate success for JAVASCRIPT connector', async () => {
      const result = await ConnectionTestService.testConnection('JAVASCRIPT', 'DESTINATION', {
        script: 'return msg;',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.latencyMs).toBe(0);
      expect(result.value.message).toContain('script-based');
    });
  });

  // ----- EMAIL (IMAP) -----

  describe('EMAIL', () => {
    it('returns success when TCP connection to IMAP host succeeds', async () => {
      createFakeSocket('connect');

      const result = await ConnectionTestService.testConnection('EMAIL', 'SOURCE', {
        host: 'imap.example.com',
        port: 993,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      expect(result.value.message).toContain('imap.example.com:993');
    });

    it('returns failure when IMAP TCP connection fails', async () => {
      createFakeSocket('error', 'ECONNREFUSED');

      const result = await ConnectionTestService.testConnection('EMAIL', 'SOURCE', {
        host: 'imap.example.com',
        port: 993,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(false);
      expect(result.value.message).toContain('ECONNREFUSED');
    });
  });

  // ----- Unknown Connector Type -----

  describe('unknown connector type', () => {
    it('returns error for unrecognized connector type', async () => {
      const result = await ConnectionTestService.testConnection('UNKNOWN_TYPE', 'DESTINATION', {});

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('Unknown connector type');
      expect(result.error.message).toContain('UNKNOWN_TYPE');
    });
  });

  // ----- SSRF Protection -----

  describe('SSRF protection', () => {
    it('blocks localhost connections', async () => {
      const result = await ConnectionTestService.testConnection('TCP_MLLP', 'DESTINATION', {
        host: 'localhost',
        port: 6661,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('blocked');
    });

    it('blocks 127.x.x.x connections', async () => {
      const result = await ConnectionTestService.testConnection('TCP_MLLP', 'DESTINATION', {
        host: '127.0.0.1',
        port: 6661,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('blocked');
    });

    it('blocks 10.x.x.x connections', async () => {
      const result = await ConnectionTestService.testConnection('TCP_MLLP', 'DESTINATION', {
        host: '10.0.0.1',
        port: 6661,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('blocked');
    });

    it('blocks 192.168.x.x connections', async () => {
      const result = await ConnectionTestService.testConnection('TCP_MLLP', 'DESTINATION', {
        host: '192.168.1.1',
        port: 6661,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('blocked');
    });

    it('blocks 172.16-31.x.x connections', async () => {
      const result = await ConnectionTestService.testConnection('TCP_MLLP', 'DESTINATION', {
        host: '172.16.0.1',
        port: 6661,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('blocked');
    });

    it('blocks HTTP requests to blocked hosts', async () => {
      const result = await ConnectionTestService.testConnection('HTTP', 'DESTINATION', {
        url: 'http://localhost:8080/api',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('blocked');
    });

    it('blocks DATABASE connections to blocked hosts', async () => {
      const result = await ConnectionTestService.testConnection('DATABASE', 'SOURCE', {
        host: '127.0.0.1',
        port: 5432,
        database: 'testdb',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('blocked');
    });

    it('blocks SMTP connections to blocked hosts', async () => {
      const result = await ConnectionTestService.testConnection('SMTP', 'DESTINATION', {
        host: '10.0.0.5',
        port: 587,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('blocked');
    });

    it('blocks FHIR connections to blocked hosts', async () => {
      const result = await ConnectionTestService.testConnection('FHIR', 'DESTINATION', {
        baseUrl: 'http://192.168.1.100/fhir',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('blocked');
    });
  });

  // ----- isBlockedHost helper -----

  describe('isBlockedHost', () => {
    it('returns true for localhost', () => {
      expect(_testing.isBlockedHost('localhost')).toBe(true);
    });

    it('returns true for 127.0.0.1', () => {
      expect(_testing.isBlockedHost('127.0.0.1')).toBe(true);
    });

    it('returns false for public hosts', () => {
      expect(_testing.isBlockedHost('example.com')).toBe(false);
    });

    it('returns false for public IP', () => {
      expect(_testing.isBlockedHost('8.8.8.8')).toBe(false);
    });

    it('returns true for IPv6 loopback', () => {
      expect(_testing.isBlockedHost('::1')).toBe(true);
    });

    it('returns true for link-local IPv6', () => {
      expect(_testing.isBlockedHost('fe80::1')).toBe(true);
    });
  });

  // ----- Latency -----

  describe('latency measurement', () => {
    it('includes latencyMs in successful result', async () => {
      const result = await ConnectionTestService.testConnection('CHANNEL', 'SOURCE', {});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value.latencyMs).toBe('number');
      expect(result.value.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('includes latencyMs in failure result', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await ConnectionTestService.testConnection('FILE', 'SOURCE', {
        directory: '/nonexistent',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value.latencyMs).toBe('number');
      expect(result.value.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ----- Timeout Constant -----

  describe('timeout configuration', () => {
    it('has a 10-second default timeout', () => {
      expect(_testing.TEST_TIMEOUT_MS).toBe(10_000);
    });
  });

  // ----- SSRF Guard (DNS-aware) -----

  describe('SSRF guard', () => {
    it('classifies private/reserved IPs as blocked', () => {
      expect(_testing.isBlockedIp('127.0.0.1')).toBe(true);
      expect(_testing.isBlockedIp('10.0.0.5')).toBe(true);
      expect(_testing.isBlockedIp('192.168.1.1')).toBe(true);
      expect(_testing.isBlockedIp('172.16.0.1')).toBe(true);
      expect(_testing.isBlockedIp('169.254.0.1')).toBe(true);
      expect(_testing.isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    });

    it('classifies public IPs as allowed', () => {
      expect(_testing.isBlockedIp('93.184.216.34')).toBe(false);
      expect(_testing.isBlockedIp('8.8.8.8')).toBe(false);
    });

    it('blocks a literal loopback hostname', async () => {
      await expect(_testing.assertHostAllowed('localhost')).rejects.toBeTruthy();
    });

    it('blocks a literal private IP', async () => {
      await expect(_testing.assertHostAllowed('127.0.0.1')).rejects.toBeTruthy();
    });

    it('blocks a DNS name that RESOLVES to a private IP (rebinding defense)', async () => {
      mockDnsLookup.mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }]);
      await expect(_testing.assertHostAllowed('evil.example.com')).rejects.toBeTruthy();
    });

    it('allows a DNS name that resolves to a public IP', async () => {
      mockDnsLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
      await expect(_testing.assertHostAllowed('good.example.com')).resolves.toBeUndefined();
    });

    it('allows an unresolvable host (the connection will fail loudly instead)', async () => {
      mockDnsLookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
      await expect(_testing.assertHostAllowed('nope.invalid')).resolves.toBeUndefined();
    });
  });
});
