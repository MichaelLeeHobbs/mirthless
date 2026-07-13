// ===========================================
// Data Source Controller
// ===========================================
// HTTP for data source CRUD + connection test. Passwords are never returned.

import type { Request, Response } from 'express';
import type { CreateDataSourceInput, UpdateDataSourceInput } from '@mirthless/core-models';
import { DataSourceService, type TestConnectionInput } from '../services/data-source.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  if (isServiceError(error, 'CONFIG_ERROR')) return 500;
  return 500;
}

function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}

export class DataSourceController {
  static async list(_req: Request, res: Response): Promise<void> {
    const result = await DataSourceService.list();
    if (!result.ok) {
      logger.error({ errMsg: result.error.message }, 'Failed to list data sources');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }
    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await DataSourceService.getById(id);
    if (!result.ok) {
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateDataSourceInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DataSourceService.create(input, context);
    if (!result.ok) {
      logger.warn({ errMsg: result.error.message, name: input.name }, 'Failed to create data source');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    logger.info({ dataSourceId: result.value.id }, 'Data source created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateDataSourceInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DataSourceService.update(id, input, context);
    if (!result.ok) {
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    logger.info({ dataSourceId: id }, 'Data source updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DataSourceService.delete(id, context);
    if (!result.ok) {
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    logger.info({ dataSourceId: id }, 'Data source deleted');
    res.status(204).send();
  }

  static async testConnection(req: Request, res: Response): Promise<void> {
    const input = req.body as TestConnectionInput;
    const result = await DataSourceService.testConnection(input);
    if (!result.ok) {
      res.status(200).json({ success: true, data: { connected: false, error: result.error.message } });
      return;
    }
    res.json({ success: true, data: { connected: true } });
  }
}
