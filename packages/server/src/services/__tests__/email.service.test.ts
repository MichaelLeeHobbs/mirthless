// ===========================================
// Email Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ----- Mocks -----

vi.mock('../settings.service.js', () => ({
  SettingsService: { getByKey: vi.fn() },
}));

vi.mock('../../lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { EmailService, setTransportFactory, resetTransportFactory } = await import('../email.service.js');
const { SettingsService } = await import('../settings.service.js');

// ----- Transport Mock -----

const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' });
const mockClose = vi.fn();

function makeMockTransport(): { sendMail: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  return { sendMail: mockSendMail, close: mockClose };
}

const mockTransportFactory = vi.fn().mockReturnValue(makeMockTransport());

// ----- Helpers -----

type MockGetByKey = ReturnType<typeof vi.fn>;
const mockGetByKey = SettingsService.getByKey as unknown as MockGetByKey;

function mockSmtpSettings(overrides?: Partial<Record<string, string | null>>): void {
  const defaults: Record<string, string> = {
    'smtp.host': 'smtp.example.com',
    'smtp.port': '587',
    'smtp.secure': 'false',
    'smtp.from': 'alerts@example.com',
    'smtp.auth_user': 'user@example.com',
    'smtp.auth_pass': 'secret123',
  };

  const values = { ...defaults, ...overrides };

  mockGetByKey.mockImplementation(async (key: string) => {
    const value = values[key];
    if (value === undefined) {
      return {
        ok: false as const,
        value: null,
        error: { code: 'NOT_FOUND', message: `Setting "${key}" not found` },
      };
    }
    return {
      ok: true as const,
      value: {
        key,
        value,
        type: 'string',
        id: 'test',
        description: null,
        category: 'smtp',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      error: null,
    };
  });
}

// ----- Setup / Teardown -----

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMail.mockResolvedValue({ messageId: 'test-msg-id' });
  mockTransportFactory.mockReturnValue(makeMockTransport());
  setTransportFactory(mockTransportFactory);
});

afterEach(() => {
  resetTransportFactory();
});

// ----- Tests -----

describe('EmailService', () => {
  // ===== getSmtpConfig =====

  describe('getSmtpConfig', () => {
    it('reads all 6 settings', async () => {
      mockSmtpSettings();

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.host).toBe('smtp.example.com');
      expect(result.value.port).toBe(587);
      expect(result.value.secure).toBe(false);
      expect(result.value.from).toBe('alerts@example.com');
      expect(result.value.authUser).toBe('user@example.com');
      expect(result.value.authPass).toBe('secret123');
      expect(mockGetByKey).toHaveBeenCalledTimes(6);
    });

    it('returns error when SMTP host is empty', async () => {
      mockSmtpSettings({ 'smtp.host': '' });

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('SMTP host is not configured');
    });

    it('returns error when host setting is missing', async () => {
      // All settings return NOT_FOUND => host will be empty string
      mockGetByKey.mockResolvedValue({
        ok: false as const,
        value: null,
        error: { code: 'NOT_FOUND', message: 'Setting not found' },
      });

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('SMTP host is not configured');
    });

    it('defaults port to 587 when not set', async () => {
      mockSmtpSettings({ 'smtp.port': '' });

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.port).toBe(587);
    });

    it('parses secure as true', async () => {
      mockSmtpSettings({ 'smtp.secure': 'true' });

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.secure).toBe(true);
    });
  });

  // ===== sendMail =====

  describe('sendMail', () => {
    it('returns success when SMTP is configured', async () => {
      mockSmtpSettings();

      const result = await EmailService.sendMail(
        ['admin@example.com'],
        'Test Alert',
        'Something went wrong.',
      );

      expect(result.ok).toBe(true);
    });

    it('passes correct options to transport', async () => {
      mockSmtpSettings();

      await EmailService.sendMail(
        ['admin@example.com', 'ops@example.com'],
        'Alert: Channel Down',
        'The channel has stopped processing.',
      );

      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'alerts@example.com',
        to: 'admin@example.com, ops@example.com',
        subject: 'Alert: Channel Down',
        text: 'The channel has stopped processing.',
      });
    });

    it('returns error when SMTP host is empty', async () => {
      mockSmtpSettings({ 'smtp.host': '' });

      const result = await EmailService.sendMail(
        ['admin@example.com'],
        'Test',
        'Body',
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('SMTP config error');
    });

    it('returns error when settings are missing', async () => {
      mockGetByKey.mockResolvedValue({
        ok: false as const,
        value: null,
        error: { code: 'NOT_FOUND', message: 'Setting not found' },
      });

      const result = await EmailService.sendMail(
        ['admin@example.com'],
        'Test',
        'Body',
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('SMTP config error');
    });

    it('returns error when transport fails', async () => {
      mockSmtpSettings();
      mockSendMail.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await EmailService.sendMail(
        ['admin@example.com'],
        'Test',
        'Body',
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('Connection refused');
    });

    it('closes transport on success', async () => {
      mockSmtpSettings();

      await EmailService.sendMail(
        ['admin@example.com'],
        'Test',
        'Body',
      );

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('closes transport on failure', async () => {
      mockSmtpSettings();
      mockSendMail.mockRejectedValueOnce(new Error('SMTP error'));

      await EmailService.sendMail(
        ['admin@example.com'],
        'Test',
        'Body',
      );

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('creates transport with correct config', async () => {
      mockSmtpSettings({ 'smtp.secure': 'true', 'smtp.port': '465' });

      await EmailService.sendMail(
        ['admin@example.com'],
        'Test',
        'Body',
      );

      expect(mockTransportFactory).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        from: 'alerts@example.com',
        authUser: 'user@example.com',
        authPass: 'secret123',
      });
    });
  });
});
