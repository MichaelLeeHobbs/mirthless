// ===========================================
// Connection Test Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConnectionTestService,
  setPoolFactory,
  setSmtpTransportFactory,
  resetFactories,
  _testing,
} from '../connection-test.service.js';

// ----- Mocks -----

// Mock node:net for TCP tests
const mockConnect = vi.fn();
vi.mock('node:net', () => ({
  connect: (...args: unknown[]) => mockConnect(...args),
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
});
