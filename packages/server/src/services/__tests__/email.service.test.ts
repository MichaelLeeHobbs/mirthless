import { createRequire } from 'node:module';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The database is faked, not SettingsService: a faked getByKey hid that it masks smtp.auth_pass.
const mockReadSettings = vi.fn<(keys: readonly string[]) => Promise<readonly unknown[]>>();

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  inArray: (_column: unknown, values: unknown) => values,
}));

vi.mock('../../lib/db.js', () => {
  const db = { select: () => ({ from: () => ({ where: (keys: readonly string[]) => mockReadSettings(keys) }) }) };
  return { db, default: db };
});

vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));

vi.mock('../../lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { EmailService, setTransportFactory, resetTransportFactory } = await import('../email.service.js');

const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' });
const mockClose = vi.fn();

function makeMockTransport(): { sendMail: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  return { sendMail: mockSendMail, close: mockClose };
}

const mockTransportFactory = vi.fn().mockReturnValue(makeMockTransport());

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

  mockReadSettings.mockImplementation(async (keys) => keys.filter((key) => values[key] !== undefined).map((key) => ({ key, value: values[key] })));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMail.mockResolvedValue({ messageId: 'test-msg-id' });
  mockTransportFactory.mockReturnValue(makeMockTransport());
  setTransportFactory(mockTransportFactory);
});

afterEach(() => {
  resetTransportFactory();
});

describe('EmailService', () => {
  describe('getSmtpConfig', () => {
    it('reads all 7 settings in one query, so a host and the password of another host never mix', async () => {
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
      expect(result.value.requireTls).toBe(false);
      expect(mockReadSettings).toHaveBeenCalledTimes(1);
    });

    it('returns error when SMTP host is empty', async () => {
      mockSmtpSettings({ 'smtp.host': '' });

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('SMTP host is not configured');
    });

    it('returns error when host setting is missing', async () => {
      mockReadSettings.mockResolvedValue([]);

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('SMTP host is not configured');
    });

    it('returns the read error when the settings cannot be read, instead of treating them as unset', async () => {
      mockReadSettings.mockRejectedValue(new Error('connection refused'));

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe('Failed to read the SMTP settings: connection refused');
    });

    it('defaults port to 587 when not set', async () => {
      mockSmtpSettings({ 'smtp.port': '' });

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.port).toBe(587);
    });

    it('parses require_tls as true', async () => {
      mockSmtpSettings({ 'smtp.require_tls': 'true' });

      const result = await EmailService.getSmtpConfig();

      expect(result).toMatchObject({ ok: true, value: { requireTls: true } });
    });

    it.each(['smtp.secure', 'smtp.require_tls'])('refuses a %s that is neither true nor false, instead of sending without TLS', async (key) => {
      mockSmtpSettings({ [key]: 'TRUE' });

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe(`${key} must be true or false`);
    });

    it('parses secure as true', async () => {
      mockSmtpSettings({ 'smtp.secure': 'true' });

      const result = await EmailService.getSmtpConfig();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.secure).toBe(true);
    });
  });

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
      mockReadSettings.mockResolvedValue([]);

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

    // A subject template can hold ${errorMessage}, which can hold PHI (#417).
    it('logs who an email went to, not its subject or its text', async () => {
      const logger = (await import('../../lib/logger.js')).default;
      mockSmtpSettings();

      await EmailService.sendMail(['admin@example.com'], 'MRN-8675309 was refused', 'PID|1||MRN-8675309');

      expect(vi.mocked(logger.info).mock.calls).toEqual([[{ to: ['admin@example.com'] }, 'Alert email sent']]);
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
        requireTls: false,
        from: 'alerts@example.com',
        authUser: 'user@example.com',
        authPass: 'secret123',
      });
    });
  });

  describe('default transport factory', () => {
    type CreateTransport = (opts: Record<string, unknown>) => unknown;
    const nodemailer = createRequire(import.meta.url)('nodemailer') as { createTransport: CreateTransport };
    const realSendMail = vi.fn().mockResolvedValue({ messageId: 'real-id' });
    const realClose = vi.fn();

    beforeEach(() => {
      resetTransportFactory();
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: realSendMail, close: realClose });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function transportOptions(): Record<string, unknown> {
      const spy = vi.mocked(nodemailer.createTransport);
      expect(spy).toHaveBeenCalledTimes(1);
      return spy.mock.calls[0]![0];
    }

    it('hands nodemailer host, port, secure and auth when a user is set', async () => {
      mockSmtpSettings({ 'smtp.secure': 'true', 'smtp.port': '465' });

      const result = await EmailService.sendMail(['admin@example.com'], 'Subj', 'Body');

      expect(result.ok).toBe(true);
      expect(transportOptions()).toEqual({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        requireTLS: false,
        auth: { user: 'user@example.com', pass: 'secret123' },
      });
      expect(realSendMail).toHaveBeenCalledWith({
        from: 'alerts@example.com',
        to: 'admin@example.com',
        subject: 'Subj',
        text: 'Body',
      });
      expect(realClose).toHaveBeenCalledTimes(1);
    });

    it('sends no auth to nodemailer when no user is set', async () => {
      mockSmtpSettings({ 'smtp.auth_user': '', 'smtp.auth_pass': 'ignored' });

      const result = await EmailService.sendMail(['admin@example.com'], 'Subj', 'Body');

      expect(result.ok).toBe(true);
      expect(transportOptions()).toEqual({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: false });
    });
  });

  // A mail server that offers no STARTTLS, as one whose offer an attacker strips looks.
  describe('a server without STARTTLS', () => {
    let server: Server;
    const sockets = new Set<Socket>();
    let seen: string[];

    function answer(socket: Socket, line: string): void {
      seen.push(line);
      if (line.startsWith('EHLO')) socket.write('250-plain\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (line.startsWith('AUTH')) socket.write('235 ok\r\n');
      else if (line === 'STARTTLS') socket.write('502 not supported\r\n');
      else if (line === 'DATA') socket.write('354 go\r\n');
      else if (line === 'QUIT') socket.end('221 bye\r\n');
      else if (/^(MAIL|RCPT|\.$)/.test(line)) socket.write('250 ok\r\n');
    }

    beforeEach(async () => {
      resetTransportFactory();
      seen = [];
      server = createServer((socket) => {
        sockets.add(socket);
        socket.on('error', () => { sockets.delete(socket); });
        socket.write('220 plain ESMTP\r\n');
        socket.on('data', (data) => {
          for (const line of data.toString('utf8').split('\r\n')) if (line !== '') answer(socket, line);
        });
      });
      await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    });

    afterEach(async () => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    });

    function settings(requireTls: string): Record<string, string> {
      return { 'smtp.host': '127.0.0.1', 'smtp.port': String((server.address() as AddressInfo).port), 'smtp.require_tls': requireTls };
    }

    it('never gets the password or the message when require_tls is on', async () => {
      mockSmtpSettings(settings('true'));

      const result = await EmailService.sendMail(['admin@example.com'], 'Subj', 'Body');

      expect(result.ok).toBe(false);
      expect(seen[0]).toMatch(/^EHLO/);
      expect(seen.filter((line) => /^(AUTH|MAIL|DATA)/.test(line))).toEqual([]);
    });

    it('never gets the password, or the message, when the email signs in, even with require_tls off', async () => {
      mockSmtpSettings(settings('false'));

      const result = await EmailService.sendMail(['admin@example.com'], 'Subj', 'Body');

      expect(result.ok).toBe(false);
      expect(seen[0]).toMatch(/^EHLO/);
      expect(seen.filter((line) => /^(AUTH|MAIL|DATA)/.test(line))).toEqual([]);
    });

    it('gets an email that does not sign in when require_tls is off', async () => {
      mockSmtpSettings({ ...settings('false'), 'smtp.auth_user': '' });

      const result = await EmailService.sendMail(['admin@example.com'], 'Subj', 'Body');

      expect(result.ok).toBe(true);
      expect(seen.some((line) => line.startsWith('AUTH'))).toBe(false);
      expect(seen).toContain('DATA');
    });
  });
});
