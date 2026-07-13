// ===========================================
// Collection Controller
// ===========================================
// Handles HTTP requests for collection CRUD + record browsing.
// Record store/find is done in-process by the script bridge, not over HTTP.

import type { Request, Response } from 'express';
import type { CreateCollectionInput, UpdateCollectionInput } from '@mirthless/core-models';
import { CollectionService } from '../services/collection.service.js';
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

export class CollectionController {
  static async list(_req: Request, res: Response): Promise<void> {
    const result = await CollectionService.list();
    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list collections');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }
    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await CollectionService.getById(id);
    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, collectionId: id }, 'Failed to get collection');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateCollectionInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CollectionService.create(input, context);
    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, name: input.name }, 'Failed to create collection');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    logger.info({ collectionId: result.value.id }, 'Collection created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateCollectionInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CollectionService.update(id, input, context);
    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, collectionId: id }, 'Failed to update collection');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    logger.info({ collectionId: id }, 'Collection updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CollectionService.delete(id, context);
    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, collectionId: id }, 'Failed to delete collection');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    logger.info({ collectionId: id }, 'Collection deleted');
    res.status(204).send();
  }

  static async listRecords(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const limit = Math.min(Number(req.query['limit'] ?? 100) || 100, 1000);
    const offset = Number(req.query['offset'] ?? 0) || 0;
    const result = await CollectionService.listRecords(id, limit, offset);
    if (!result.ok) {
      logger.error({ errMsg: result.error.message, collectionId: id }, 'Failed to list collection records');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }
    res.json({ success: true, data: result.value });
  }
}
