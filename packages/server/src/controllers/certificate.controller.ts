// ===========================================
// Certificate Controller
// ===========================================
// Handles HTTP requests for certificate CRUD.

import type { Request, Response } from 'express';
import type { CreateCertificateInput, UpdateCertificateInput, CertificateListQuery } from '@mirthless/core-models';
import { CertificateService } from '../services/certificate.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  if (isServiceError(error, 'INVALID_INPUT')) return 400;
  return 500;
}

function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}

export class CertificateController {
  static async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as CertificateListQuery;
    const result = await CertificateService.list(query);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list certificates');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await CertificateService.getById(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, certificateId: id }, 'Failed to get certificate');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateCertificateInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CertificateService.create(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, name: input.name }, 'Failed to create certificate');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ certificateId: result.value.id }, 'Certificate created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateCertificateInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CertificateService.update(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, certificateId: id }, 'Failed to update certificate');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ certificateId: id }, 'Certificate updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CertificateService.delete(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, certificateId: id }, 'Failed to delete certificate');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ certificateId: id }, 'Certificate deleted');
    res.status(204).send();
  }
}
