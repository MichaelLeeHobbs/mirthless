// ===========================================
// Connector Validation Service Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { validateConnectorProperties } from '../connector-validation.service.js';

// ----- Source Connectors -----

describe('validateConnectorProperties', () => {
  describe('source connectors', () => {
    it('accepts valid TCP_MLLP source properties', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', { port: 6661 });
      expect(result.ok).toBe(true);
    });

    it('rejects TCP_MLLP source with missing port', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('port');
    });

    it('rejects TCP_MLLP source with port out of range (0)', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', { port: 0 });
      expect(result.ok).toBe(false);
    });

    it('rejects TCP_MLLP source with port out of range (65536)', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', { port: 65536 });
      expect(result.ok).toBe(false);
    });

    it('accepts valid HTTP source properties', () => {
      const result = validateConnectorProperties('HTTP', 'source', { port: 8080 });
      expect(result.ok).toBe(true);
    });

    it('rejects HTTP source with missing port', () => {
      const result = validateConnectorProperties('HTTP', 'source', {});
      expect(result.ok).toBe(false);
    });

    it('accepts valid FILE source properties', () => {
      const result = validateConnectorProperties('FILE', 'source', { directory: '/data/in' });
      expect(result.ok).toBe(true);
    });

    it('rejects FILE source with empty directory', () => {
      const result = validateConnectorProperties('FILE', 'source', { directory: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('directory');
    });

    it('accepts valid DATABASE source properties', () => {
      const result = validateConnectorProperties('DATABASE', 'source', {
        host: 'localhost', port: 5432, database: 'mydb', selectQuery: 'SELECT 1',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects DATABASE source with missing host', () => {
      const result = validateConnectorProperties('DATABASE', 'source', {
        port: 5432, database: 'mydb', selectQuery: 'SELECT 1',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
    });

    it('accepts valid JAVASCRIPT source properties', () => {
      const result = validateConnectorProperties('JAVASCRIPT', 'source', { script: 'return "ok";' });
      expect(result.ok).toBe(true);
    });

    it('rejects JAVASCRIPT source with empty script', () => {
      const result = validateConnectorProperties('JAVASCRIPT', 'source', { script: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('script');
    });

    it('accepts valid CHANNEL source properties', () => {
      const result = validateConnectorProperties('CHANNEL', 'source', { channelId: 'abc-123' });
      expect(result.ok).toBe(true);
    });

    it('rejects CHANNEL source with empty channelId', () => {
      const result = validateConnectorProperties('CHANNEL', 'source', { channelId: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('channelId');
    });

    it('accepts valid DICOM source properties', () => {
      const result = validateConnectorProperties('DICOM', 'source', {
        port: 4242, storageDir: '/data/dicom',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects DICOM source with missing storageDir', () => {
      const result = validateConnectorProperties('DICOM', 'source', { port: 4242 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('storageDir');
    });

    it('rejects DICOM source with invalid port', () => {
      const result = validateConnectorProperties('DICOM', 'source', { port: 0, storageDir: '/data' });
      expect(result.ok).toBe(false);
    });

    it('allows extra properties via passthrough', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', {
        port: 6661, bufferSize: 65536, charset: 'UTF-8',
      });
      expect(result.ok).toBe(true);
    });
  });

  // ----- Destination Connectors -----

  describe('destination connectors', () => {
    it('accepts valid TCP_MLLP destination properties', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'destination', {
        host: 'remote-host', port: 6661,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects TCP_MLLP destination with missing host', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'destination', { port: 6661 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
    });

    it('accepts valid HTTP destination properties', () => {
      const result = validateConnectorProperties('HTTP', 'destination', {
        url: 'http://example.com/api',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects HTTP destination with empty url', () => {
      const result = validateConnectorProperties('HTTP', 'destination', { url: '' });
      expect(result.ok).toBe(false);
    });

    it('accepts valid FILE destination properties', () => {
      const result = validateConnectorProperties('FILE', 'destination', { directory: '/data/out' });
      expect(result.ok).toBe(true);
    });

    it('rejects FILE destination with missing directory', () => {
      const result = validateConnectorProperties('FILE', 'destination', {});
      expect(result.ok).toBe(false);
    });

    it('accepts valid DATABASE destination properties', () => {
      const result = validateConnectorProperties('DATABASE', 'destination', {
        host: 'localhost', port: 5432, database: 'mydb', query: 'INSERT INTO t VALUES ($1)',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects DATABASE destination with missing query', () => {
      const result = validateConnectorProperties('DATABASE', 'destination', {
        host: 'localhost', port: 5432, database: 'mydb',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('query');
    });

    it('accepts valid JAVASCRIPT destination properties', () => {
      const result = validateConnectorProperties('JAVASCRIPT', 'destination', { script: 'return msg;' });
      expect(result.ok).toBe(true);
    });

    it('rejects JAVASCRIPT destination with empty script', () => {
      const result = validateConnectorProperties('JAVASCRIPT', 'destination', { script: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('script');
    });

    it('accepts valid SMTP destination properties', () => {
      const result = validateConnectorProperties('SMTP', 'destination', {
        host: 'smtp.example.com', port: 587, to: 'admin@example.com',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects SMTP destination with missing to', () => {
      const result = validateConnectorProperties('SMTP', 'destination', {
        host: 'smtp.example.com', port: 587,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('to');
    });

    it('accepts valid CHANNEL destination properties', () => {
      const result = validateConnectorProperties('CHANNEL', 'destination', {
        targetChannelId: 'target-abc-123',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects CHANNEL destination with empty targetChannelId', () => {
      const result = validateConnectorProperties('CHANNEL', 'destination', { targetChannelId: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('targetChannelId');
    });

    it('accepts valid FHIR destination properties', () => {
      const result = validateConnectorProperties('FHIR', 'destination', {
        baseUrl: 'https://fhir.example.com/r4',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects FHIR destination with empty baseUrl', () => {
      const result = validateConnectorProperties('FHIR', 'destination', { baseUrl: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('baseUrl');
    });

    it('accepts valid DICOM destination properties', () => {
      const result = validateConnectorProperties('DICOM', 'destination', {
        host: '192.168.1.100', port: 104,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects DICOM destination with missing host', () => {
      const result = validateConnectorProperties('DICOM', 'destination', { port: 104 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
    });

    it('rejects DICOM destination with invalid port', () => {
      const result = validateConnectorProperties('DICOM', 'destination', { host: 'pacs.local', port: 0 });
      expect(result.ok).toBe(false);
    });
  });

  // ----- Unknown Type -----

  describe('unknown connector type', () => {
    it('passes validation for unknown source connector type', () => {
      const result = validateConnectorProperties('UNKNOWN_TYPE', 'source', {});
      expect(result.ok).toBe(true);
    });

    it('passes validation for unknown destination connector type', () => {
      const result = validateConnectorProperties('FUTURE_CONNECTOR', 'destination', { foo: 'bar' });
      expect(result.ok).toBe(true);
    });
  });

  // ----- Error Message Format -----

  describe('error messages', () => {
    it('includes connector type and mode in error message', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('source');
      expect(result.error.message).toContain('TCP_MLLP');
    });

    it('includes INVALID_INPUT error code', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INVALID_INPUT');
    });
  });
});
