// ===========================================
// Certificate Service
// ===========================================
// Business logic for SSL/TLS certificate CRUD.
// All methods return Result<T> using tryCatch from stderr-lib.

import { X509Certificate } from 'node:crypto';
import { tryCatch, type Result } from 'stderr-lib';
import { eq, asc, lte, ilike, and, type SQL } from 'drizzle-orm';
import type { CreateCertificateInput, UpdateCertificateInput, CertificateListQuery } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { certificates } from '../db/schema/index.js';

// ----- Response Types -----

export interface CertificateSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly fingerprint: string;
  readonly issuer: string;
  readonly subject: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CertificateDetail extends CertificateSummary {
  readonly certificatePem: string;
  readonly privateKeyPem: string | null;
}

// ----- Helpers -----

interface ParsedCertInfo {
  readonly fingerprint: string;
  readonly issuer: string;
  readonly subject: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
}

/** Parse a PEM-encoded certificate and extract metadata. */
function parsePem(pem: string): ParsedCertInfo {
  const cert = new X509Certificate(pem);
  const rawFingerprint = cert.fingerprint256;
  return {
    fingerprint: rawFingerprint,
    issuer: cert.issuer,
    subject: cert.subject,
    notBefore: new Date(cert.validFrom),
    notAfter: new Date(cert.validTo),
  };
}

function toSummary(row: typeof certificates.$inferSelect): CertificateSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    fingerprint: row.fingerprint,
    issuer: row.issuer,
    subject: row.subject,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: typeof certificates.$inferSelect): CertificateDetail {
  return {
    ...toSummary(row),
    certificatePem: row.certificatePem,
    privateKeyPem: row.privateKeyPem,
  };
}

// ----- Service -----

export class CertificateService {
  /** List certificates (metadata only, no PEM content). */
  static async list(query?: CertificateListQuery): Promise<Result<readonly CertificateSummary[]>> {
    return tryCatch(async () => {
      const conditions: SQL[] = [];

      if (query?.type) {
        conditions.push(eq(certificates.type, query.type));
      }
      if (query?.search) {
        conditions.push(ilike(certificates.name, `%${query.search}%`));
      }
      if (query?.expiringSoon) {
        const threshold = new Date();
        threshold.setDate(threshold.getDate() + 90);
        conditions.push(lte(certificates.notAfter, threshold));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const baseQuery = db
        .select({
          id: certificates.id,
          name: certificates.name,
          description: certificates.description,
          type: certificates.type,
          fingerprint: certificates.fingerprint,
          issuer: certificates.issuer,
          subject: certificates.subject,
          notBefore: certificates.notBefore,
          notAfter: certificates.notAfter,
          createdAt: certificates.createdAt,
          updatedAt: certificates.updatedAt,
        })
        .from(certificates);

      const rows = whereClause
        ? await baseQuery.where(whereClause).orderBy(asc(certificates.name))
        : await baseQuery.orderBy(asc(certificates.name));

      return rows;
    });
  }

  /** Get a single certificate by ID (with PEM content). */
  static async getById(id: string): Promise<Result<CertificateDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(certificates)
        .where(eq(certificates.id, id));

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Certificate ${id} not found`);
      }

      return toDetail(row);
    });
  }

  /** Create a new certificate. */
  static async create(
    input: CreateCertificateInput,
    context?: AuditContext,
  ): Promise<Result<CertificateDetail>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: certificates.id })
        .from(certificates)
        .where(eq(certificates.name, input.name));

      if (existing) {
        throw new ServiceError('ALREADY_EXISTS', `Certificate "${input.name}" already exists`);
      }

      let certInfo: ParsedCertInfo;
      try {
        certInfo = parsePem(input.certificatePem);
      } catch {
        throw new ServiceError('INVALID_INPUT', 'Invalid PEM certificate: unable to parse');
      }

      const [row] = await db
        .insert(certificates)
        .values({
          name: input.name,
          description: input.description ?? null,
          type: input.type,
          certificatePem: input.certificatePem,
          privateKeyPem: input.privateKeyPem ?? null,
          fingerprint: certInfo.fingerprint,
          issuer: certInfo.issuer,
          subject: certInfo.subject,
          notBefore: certInfo.notBefore,
          notAfter: certInfo.notAfter,
        })
        .returning();

      emitEvent({
        level: 'INFO', name: 'SETTINGS_CHANGED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'certificate_create', certificateName: input.name },
      });

      return toDetail(row!);
    });
  }

  /** Update a certificate. */
  static async update(
    id: string,
    input: UpdateCertificateInput,
    context?: AuditContext,
  ): Promise<Result<CertificateDetail>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select()
        .from(certificates)
        .where(eq(certificates.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Certificate ${id} not found`);
      }

      if (input.name && input.name !== existing.name) {
        const [dup] = await db
          .select({ id: certificates.id })
          .from(certificates)
          .where(eq(certificates.name, input.name));

        if (dup) {
          throw new ServiceError('ALREADY_EXISTS', `Certificate "${input.name}" already exists`);
        }
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.description !== undefined) updates['description'] = input.description;
      if (input.type !== undefined) updates['type'] = input.type;
      if (input.privateKeyPem !== undefined) updates['privateKeyPem'] = input.privateKeyPem;

      if (input.certificatePem !== undefined) {
        let certInfo: ParsedCertInfo;
        try {
          certInfo = parsePem(input.certificatePem);
        } catch {
          throw new ServiceError('INVALID_INPUT', 'Invalid PEM certificate: unable to parse');
        }

        updates['certificatePem'] = input.certificatePem;
        updates['fingerprint'] = certInfo.fingerprint;
        updates['issuer'] = certInfo.issuer;
        updates['subject'] = certInfo.subject;
        updates['notBefore'] = certInfo.notBefore;
        updates['notAfter'] = certInfo.notAfter;
      }

      const [row] = await db
        .update(certificates)
        .set(updates)
        .where(eq(certificates.id, id))
        .returning();

      emitEvent({
        level: 'INFO', name: 'SETTINGS_CHANGED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'certificate_update', certificateId: id },
      });

      return toDetail(row!);
    });
  }

  /** Delete a certificate. */
  static async delete(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: certificates.id })
        .from(certificates)
        .where(eq(certificates.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Certificate ${id} not found`);
      }

      await db
        .delete(certificates)
        .where(eq(certificates.id, id));

      emitEvent({
        level: 'INFO', name: 'SETTINGS_CHANGED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'certificate_delete', certificateId: id },
      });
    });
  }

  /** Get certificates expiring within the given number of days. */
  static async getExpiring(days: number): Promise<Result<readonly CertificateSummary[]>> {
    return tryCatch(async () => {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() + days);

      const rows = await db
        .select({
          id: certificates.id,
          name: certificates.name,
          description: certificates.description,
          type: certificates.type,
          fingerprint: certificates.fingerprint,
          issuer: certificates.issuer,
          subject: certificates.subject,
          notBefore: certificates.notBefore,
          notAfter: certificates.notAfter,
          createdAt: certificates.createdAt,
          updatedAt: certificates.updatedAt,
        })
        .from(certificates)
        .where(lte(certificates.notAfter, threshold))
        .orderBy(asc(certificates.notAfter));

      return rows;
    });
  }
}
