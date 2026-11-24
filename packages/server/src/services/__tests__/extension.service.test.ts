import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../settings.service.js', () => ({
  SettingsService: {
    list: vi.fn(),
    getByKey: vi.fn(),
    upsert: vi.fn(),
  },
}));

import { ExtensionService } from '../extension.service.js';
import { SettingsService } from '../settings.service.js';
import { ServiceError } from '../../lib/service-error.js';

const mockList = vi.mocked(SettingsService.list);
const mockGetByKey = vi.mocked(SettingsService.getByKey);
const mockUpsert = vi.mocked(SettingsService.upsert);

beforeEach(() => {
  mockList.mockReset();
  mockGetByKey.mockReset();
  mockUpsert.mockReset();
});

describe('ExtensionService.list', () => {
  it('returns all built-in extensions', async () => {
    // No settings → all enabled by default
    mockList.mockResolvedValue({ ok: true, value: [], error: null });

    const result = await ExtensionService.list();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(17); // 9 connectors + 8 data types
      expect(result.value.every((e) => e.enabled)).toBe(true);
    }
  });

  it('returns disabled extensions when setting is false', async () => {
    mockList.mockResolvedValue({
      ok: true,
      value: [
        { id: '1', key: 'extension.tcp-mllp.enabled', value: 'false', type: 'boolean', description: null, category: 'extensions', createdAt: new Date(), updatedAt: new Date() },
      ] as never,
      error: null,
    });

    const result = await ExtensionService.list();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const tcpMllp = result.value.find((e) => e.id === 'tcp-mllp');
      expect(tcpMllp?.enabled).toBe(false);
    }
  });

  it('includes connector and data type extensions', async () => {
    mockList.mockResolvedValue({ ok: true, value: [], error: null });

    const result = await ExtensionService.list();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const connectors = result.value.filter((e) => e.type === 'CONNECTOR');
      const dataTypes = result.value.filter((e) => e.type === 'DATA_TYPE');
      expect(connectors.length).toBe(9);
      expect(dataTypes.length).toBe(8);
    }
  });
});

describe('ExtensionService when the settings cannot be read', () => {
  const failed = { ok: false, value: null, error: new Error('connection refused') } as never;

  it('fails the list instead of showing every extension as enabled', async () => {
    mockList.mockResolvedValue(failed);

    const result = await ExtensionService.list();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('connection refused');
  });

  it('fails one extension instead of showing it as enabled', async () => {
    mockGetByKey.mockResolvedValue(failed);

    const result = await ExtensionService.getById('tcp-mllp');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('connection refused');
  });
});

describe('ExtensionService.getById', () => {
  it('returns extension by ID', async () => {
    mockGetByKey.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'Not found') } as never);

    const result = await ExtensionService.getById('tcp-mllp');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('tcp-mllp');
      expect(result.value.enabled).toBe(true);
      expect(result.value.name).toBe('TCP/MLLP');
      expect(result.value.type).toBe('CONNECTOR');
    }
  });

  it('returns NOT_FOUND for unknown ID', async () => {
    const result = await ExtensionService.getById('nonexistent');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns data type extension by ID', async () => {
    mockGetByKey.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'Not found') } as never);

    const result = await ExtensionService.getById('dt-hl7v2');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('HL7 v2.x');
      expect(result.value.type).toBe('DATA_TYPE');
    }
  });
});

describe('ExtensionService.setEnabled', () => {
  it('enables an extension', async () => {
    mockUpsert.mockResolvedValue({ ok: true, value: {} as never, error: null });

    const result = await ExtensionService.setEnabled('http', true);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('http');
      expect(result.value.enabled).toBe(true);
    }
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      key: 'extension.http.enabled',
      value: 'true',
    }));
  });

  it('disables an extension', async () => {
    mockUpsert.mockResolvedValue({ ok: true, value: {} as never, error: null });

    const result = await ExtensionService.setEnabled('smtp', false);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('smtp');
      expect(result.value.enabled).toBe(false);
    }
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      key: 'extension.smtp.enabled',
      value: 'false',
    }));
  });

  it('returns NOT_FOUND for unknown ID', async () => {
    const result = await ExtensionService.setEnabled('nonexistent', true);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns error when settings upsert fails', async () => {
    mockUpsert.mockResolvedValue({ ok: false, value: null, error: { code: 'INTERNAL', message: 'DB error' } as never });

    mockUpsert.mockRejectedValue(new Error('DB error'));

    const result = await ExtensionService.setEnabled('http', true);

    expect(result.ok).toBe(false);
  });

  it('returns the error when the settings upsert returns a failed Result', async () => {
    mockUpsert.mockResolvedValue({ ok: false, value: null, error: new Error('DB error') } as never);

    const result = await ExtensionService.setEnabled('http', false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('DB error');
    }
  });
});

describe('ExtensionService — capabilities', () => {
  it('SMTP connector has only destination capability', async () => {
    mockGetByKey.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'Not found') } as never);

    const result = await ExtensionService.getById('smtp');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.capabilities).toEqual(['destination']);
    }
  });

  it('HTTP connector has source and destination capabilities', async () => {
    mockGetByKey.mockResolvedValue({ ok: false, value: null, error: new ServiceError('NOT_FOUND', 'Not found') } as never);

    const result = await ExtensionService.getById('http');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.capabilities).toEqual(['source', 'destination']);
    }
  });
});
