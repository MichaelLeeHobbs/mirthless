// What the server log gets, and a configuration map that cannot be read. The rest runs against Postgres
// in connection-test-references.itest.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { ALL_CHANNELS } from '@galvanigraph/core-models';

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
vi.mock('../../lib/logger.js', () => ({ default: log }));
vi.mock('../../lib/audited-read.js', () => ({ recordReadBestEffort: vi.fn() }));
const references = vi.fn();
vi.mock('../../services/config-map.service.js', () => ({ ConfigMapService: { references } }));
const testConnection = vi.fn();
vi.mock('../../services/connection-test.service.js', () => ({ ConnectionTestService: { testConnection } }));

const { ConnectionTestController } = await import('../connection-test.controller.js');
const { ServiceError } = await import('../../lib/service-error.js');

const status = vi.fn();
const json = vi.fn();
const res = { status: status.mockReturnThis(), json: json.mockReturnThis() } as unknown as Response;
const grants = new Map([['channels:deploy', ALL_CHANNELS], ['config_map:read', ALL_CHANNELS]]);

const test = (properties: Record<string, unknown>): Promise<void> => ConnectionTestController.test(
  { body: { connectorType: 'SMTP', mode: 'DESTINATION', properties }, principal: { grants } } as unknown as Request, res,
);

beforeEach(() => {
  vi.clearAllMocks();
  references.mockResolvedValue({ ok: true, value: new Map([['partner.password', 's3cr3t']]), error: null });
});

describe('a connection test', () => {
  it('is not run when the configuration map cannot be read, and the log says why', async () => {
    references.mockResolvedValue({ ok: false, value: null, error: new Error('connection terminated') });

    await test({ host: 'smtp.example.com' });

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL', message: 'Could not load the configuration map' } });
    expect(testConnection).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ errMsg: 'connection terminated' }), 'Could not load the configuration map for a connection test',
    );
  });

  it('that is refused is logged with the code alone, because its reason can hold a value of the map', async () => {
    testConnection.mockResolvedValue({ ok: false, value: null, error: new ServiceError('INVALID_INPUT', 'authPass: s3cr3t is no password') });

    await test({ authPass: '${partner.password}' });

    expect(testConnection).toHaveBeenCalledWith('SMTP', 'DESTINATION', { authPass: 's3cr3t' });
    expect(json).toHaveBeenCalledWith({ success: false, error: { code: 'INVALID_INPUT', message: 'authPass: s3cr3t is no password' } });
    expect(log.warn.mock.calls).toEqual([[{ code: 'INVALID_INPUT', connectorType: 'SMTP', mode: 'DESTINATION' }, 'Connection test refused']]);
    expect(log.error).not.toHaveBeenCalled();
  });
});
