// ===========================================
// Certificate Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushResponse(value: unknown): void {
  selectResponses.push(() => value);
}

function pushOrderableResponse(value: unknown): void {
  selectResponses.push(() =>
    Object.assign(Promise.resolve(value), {
      orderBy: vi.fn().mockResolvedValue(value),
    }),
  );
}

/** Push a response for queries that go through .from().orderBy() (no where). */
function pushFromOrderByResponse(value: unknown): void {
  selectResponses.push(() => value);
}

/** Push a response for queries that go through .from().where().orderBy(). */
function pushWhereOrderByResponse(value: unknown): void {
  selectResponses.push(() => ({
    orderBy: vi.fn().mockResolvedValue(value),
  }));
}

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
});

const mockSelectFrom = vi.fn().mockImplementation(() => ({
  where: mockSelectWhere,
  orderBy: vi.fn().mockImplementation(() => {
    const fn = selectResponses[selectCallIndex];
    selectCallIndex++;
    if (fn) return fn();
    return [];
  }),
}));

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateReturning = vi.fn();
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
  lte: vi.fn((_col: unknown, val: unknown) => ({ type: 'lte', val })),
  ilike: vi.fn((_col: unknown, val: unknown) => ({ type: 'ilike', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', conditions: args })),
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

// Mock node:crypto X509Certificate
const mockX509 = {
  fingerprint256: 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
  issuer: 'CN=Test CA',
  subject: 'CN=test.example.com',
  validFrom: '2025-01-01T00:00:00Z',
  validTo: '2027-01-01T00:00:00Z',
};

vi.mock('node:crypto', () => ({
  X509Certificate: vi.fn().mockImplementation((pem: string) => {
    if (!pem.includes('BEGIN CERTIFICATE')) {
      throw new Error('Invalid PEM');
    }
    return { ...mockX509 };
  }),
}));

const { CertificateService } = await import('../certificate.service.js');

// ----- Fixtures -----

const NOW = new Date('2026-03-03T12:00:00Z');
const CERT_ID = '00000000-0000-0000-0000-000000000001';

function makeCertRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: CERT_ID,
    name: 'test-cert',
    description: 'A test certificate',
    type: 'CA',
    certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBkTCB...\n-----END CERTIFICATE-----',
    privateKeyPem: null,
    fingerprint: 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
    issuer: 'CN=Test CA',
    subject: 'CN=test.example.com',
    notBefore: new Date('2025-01-01T00:00:00Z'),
    notAfter: new Date('2027-01-01T00:00:00Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
});

describe('CertificateService', () => {
  describe('list', () => {
    it('returns certificates with metadata (no PEM content)', async () => {
      const row = makeCertRow();
      pushFromOrderByResponse([row]);

      const result = await CertificateService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.name).toBe('test-cert');
    });

    it('returns empty array when no certificates exist', async () => {
      pushFromOrderByResponse([]);

      const result = await CertificateService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('filters by type when provided', async () => {
      pushWhereOrderByResponse([]);

      const result = await CertificateService.list({ type: 'CA' });

      expect(result.ok).toBe(true);
    });

    it('filters by search when provided', async () => {
      pushWhereOrderByResponse([]);

      const result = await CertificateService.list({ search: 'test' });

      expect(result.ok).toBe(true);
    });

    it('filters expiring certificates when expiringSoon is true', async () => {
      pushWhereOrderByResponse([]);

      const result = await CertificateService.list({ expiringSoon: true });

      expect(result.ok).toBe(true);
    });
  });

  describe('getById', () => {
    it('returns certificate with PEM content', async () => {
      const row = makeCertRow();
      pushResponse([row]);

      const result = await CertificateService.getById(CERT_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(CERT_ID);
      expect(result.value.certificatePem).toContain('BEGIN CERTIFICATE');
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await CertificateService.getById(CERT_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('create', () => {
    it('succeeds with valid PEM certificate', async () => {
      const created = makeCertRow();
      pushResponse([]); // no existing
      mockReturning.mockResolvedValueOnce([created]);

      const result = await CertificateService.create({
        name: 'test-cert',
        type: 'CA',
        certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBkTCB...\n-----END CERTIFICATE-----',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('test-cert');
      expect(result.value.fingerprint).toBe(mockX509.fingerprint256);
    });

    it('extracts fingerprint, issuer, subject, and dates from PEM', async () => {
      const created = makeCertRow();
      pushResponse([]); // no existing
      mockReturning.mockResolvedValueOnce([created]);

      const result = await CertificateService.create({
        name: 'test-cert',
        type: 'CA',
        certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBkTCB...\n-----END CERTIFICATE-----',
      });

      expect(result.ok).toBe(true);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          fingerprint: mockX509.fingerprint256,
          issuer: mockX509.issuer,
          subject: mockX509.subject,
        }),
      );
    });

    it('returns ALREADY_EXISTS for duplicate name', async () => {
      pushResponse([{ id: CERT_ID }]); // existing found

      const result = await CertificateService.create({
        name: 'test-cert',
        type: 'CA',
        certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBkTCB...\n-----END CERTIFICATE-----',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already exists'));
    });

    it('returns INVALID_INPUT for invalid PEM', async () => {
      pushResponse([]); // no existing

      const result = await CertificateService.create({
        name: 'bad-cert',
        type: 'CA',
        certificatePem: 'not a valid pem',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Invalid PEM'));
    });

    it('stores optional private key PEM', async () => {
      const created = makeCertRow({ privateKeyPem: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----' });
      pushResponse([]); // no existing
      mockReturning.mockResolvedValueOnce([created]);

      const result = await CertificateService.create({
        name: 'test-cert',
        type: 'KEYPAIR',
        certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBkTCB...\n-----END CERTIFICATE-----',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
      });

      expect(result.ok).toBe(true);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKeyPem: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
        }),
      );
    });

    it('stores description when provided', async () => {
      const created = makeCertRow({ description: 'My CA cert' });
      pushResponse([]); // no existing
      mockReturning.mockResolvedValueOnce([created]);

      const result = await CertificateService.create({
        name: 'test-cert',
        description: 'My CA cert',
        type: 'CA',
        certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBkTCB...\n-----END CERTIFICATE-----',
      });

      expect(result.ok).toBe(true);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'My CA cert',
        }),
      );
    });
  });

  describe('update', () => {
    it('succeeds with name change', async () => {
      const row = makeCertRow();
      const updated = makeCertRow({ name: 'renamed-cert' });
      pushResponse([row]); // existing
      pushResponse([]); // no dup
      mockUpdateReturning.mockResolvedValueOnce([updated]);

      const result = await CertificateService.update(CERT_ID, { name: 'renamed-cert' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('renamed-cert');
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await CertificateService.update(CERT_ID, { name: 'test.pem' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });

    it('returns ALREADY_EXISTS on duplicate name', async () => {
      const row = makeCertRow();
      pushResponse([row]); // existing
      pushResponse([{ id: '00000000-0000-0000-0000-000000000002' }]); // dup found

      const result = await CertificateService.update(CERT_ID, { name: 'dup-name' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already exists'));
    });

    it('re-parses PEM when certificatePem changes', async () => {
      const row = makeCertRow();
      const updated = makeCertRow({ certificatePem: '-----BEGIN CERTIFICATE-----\nNEW...\n-----END CERTIFICATE-----' });
      pushResponse([row]); // existing
      mockUpdateReturning.mockResolvedValueOnce([updated]);

      const result = await CertificateService.update(CERT_ID, {
        certificatePem: '-----BEGIN CERTIFICATE-----\nNEW...\n-----END CERTIFICATE-----',
      });

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          fingerprint: mockX509.fingerprint256,
          issuer: mockX509.issuer,
          subject: mockX509.subject,
        }),
      );
    });

    it('returns INVALID_INPUT when updated PEM is invalid', async () => {
      const row = makeCertRow();
      pushResponse([row]); // existing

      const result = await CertificateService.update(CERT_ID, {
        certificatePem: 'not valid pem',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Invalid PEM'));
    });
  });

  describe('delete', () => {
    it('succeeds', async () => {
      pushResponse([{ id: CERT_ID }]);

      const result = await CertificateService.delete(CERT_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await CertificateService.delete(CERT_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('getExpiring', () => {
    it('returns certificates expiring within given days', async () => {
      const row = makeCertRow({ notAfter: new Date('2026-03-10T00:00:00Z') });
      pushOrderableResponse([row]);

      const result = await CertificateService.getExpiring(30);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
    });

    it('returns empty array when no certificates are expiring', async () => {
      pushOrderableResponse([]);

      const result = await CertificateService.getExpiring(30);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });
});
