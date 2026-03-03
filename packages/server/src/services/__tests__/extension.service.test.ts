// ===========================================
// Extension Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SettingsService
vi.mock('../settings.service.js', () => ({
  SettingsService: {
    list: vi.fn(),
    getByKey: vi.fn(),
    upsert: vi.fn(),
  },
}));

import { ExtensionService } from '../extension.service.js';
import { SettingsService } from '../settings.service.js';

const mockList = vi.mocked(SettingsService.list);
const mockGetByKey = vi.mocked(SettingsService.getByKey);
const mockUpsert = vi.mocked(SettingsService.upsert);

// ----- Setup -----

beforeEach(() => {
  mockList.mockReset();
  mockGetByKey.mockReset();
  mockUpsert.mockReset();
});

// ----- list -----

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

// ----- getById -----

describe('ExtensionService.getById', () => {
  it('returns extension by ID', async () => {
    mockGetByKey.mockResolvedValue({ ok: false, value: null, error: { code: 'NOT_FOUND', message: 'Not found' } as never });

    const result = await ExtensionService.getById('tcp-mllp');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('tcp-mllp');
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
    mockGetByKey.mockResolvedValue({ ok: false, value: null, error: { code: 'NOT_FOUND', message: 'Not found' } as never });

    const result = await ExtensionService.getById('dt-hl7v2');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('HL7 v2.x');
      expect(result.value.type).toBe('DATA_TYPE');
    }
  });
});

// ----- setEnabled -----

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

    // The upsert error is thrown inside tryCatch
    mockUpsert.mockRejectedValue(new Error('DB error'));

    const result = await ExtensionService.setEnabled('http', true);

    expect(result.ok).toBe(false);
  });
});

// ----- Extension capabilities -----

describe('ExtensionService — capabilities', () => {
  it('SMTP connector has only destination capability', async () => {
    mockGetByKey.mockResolvedValue({ ok: false, value: null, error: { code: 'NOT_FOUND', message: 'Not found' } as never });

    const result = await ExtensionService.getById('smtp');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.capabilities).toEqual(['destination']);
    }
  });

  it('HTTP connector has source and destination capabilities', async () => {
    mockGetByKey.mockResolvedValue({ ok: false, value: null, error: { code: 'NOT_FOUND', message: 'Not found' } as never });

    const result = await ExtensionService.getById('http');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.capabilities).toEqual(['source', 'destination']);
    }
  });
});
