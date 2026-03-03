// ===========================================
// Certificate Zod Schemas
// ===========================================
// Validation schemas for SSL/TLS certificate management.

import { z } from 'zod/v4';

// ----- Const Objects -----

export const CERTIFICATE_TYPE = {
  CA: 'CA',
  CLIENT: 'CLIENT',
  SERVER: 'SERVER',
  KEYPAIR: 'KEYPAIR',
} as const;

export type CertificateType = (typeof CERTIFICATE_TYPE)[keyof typeof CERTIFICATE_TYPE];

const certificateTypeValues = [
  CERTIFICATE_TYPE.CA,
  CERTIFICATE_TYPE.CLIENT,
  CERTIFICATE_TYPE.SERVER,
  CERTIFICATE_TYPE.KEYPAIR,
] as const;

// ----- CRUD Schemas -----

export const createCertificateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(certificateTypeValues),
  certificatePem: z.string().min(1),
  privateKeyPem: z.string().optional(),
});

export type CreateCertificateInput = z.infer<typeof createCertificateSchema>;

export const updateCertificateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  type: z.enum(certificateTypeValues).optional(),
  certificatePem: z.string().min(1).optional(),
  privateKeyPem: z.string().nullable().optional(),
});

export type UpdateCertificateInput = z.infer<typeof updateCertificateSchema>;

// ----- Query Schema -----

export const certificateListQuerySchema = z.object({
  type: z.enum(certificateTypeValues).optional(),
  search: z.string().optional(),
  expiringSoon: z.coerce.boolean().optional(),
});

export type CertificateListQuery = z.infer<typeof certificateListQuerySchema>;

// ----- Params -----

export const certificateUuidParamSchema = z.object({
  id: z.string().uuid(),
});
