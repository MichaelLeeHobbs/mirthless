// ===========================================
// Code Template Controller
// ===========================================
// Handles HTTP requests for code template library + template CRUD.

import type { Request, Response } from 'express';
import type {
  CreateCodeTemplateLibraryInput,
  UpdateCodeTemplateLibraryInput,
  CreateCodeTemplateInput,
  UpdateCodeTemplateInput,
  CodeTemplateListQuery,
} from '@mirthless/core-models';
import { CodeTemplateService } from '../services/code-template.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  if (isServiceError(error, 'CONFLICT')) return 409;
  return 500;
}

function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}

export class CodeTemplateController {
  // ===== Libraries =====

  static async listLibraries(_req: Request, res: Response): Promise<void> {
    const result = await CodeTemplateService.listLibraries();

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list libraries');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async createLibrary(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateCodeTemplateLibraryInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CodeTemplateService.createLibrary(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, name: input.name }, 'Failed to create library');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ libraryId: result.value.id }, 'Library created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async updateLibrary(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateCodeTemplateLibraryInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CodeTemplateService.updateLibrary(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, libraryId: id }, 'Failed to update library');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ libraryId: id }, 'Library updated');
    res.json({ success: true, data: result.value });
  }

  static async deleteLibrary(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CodeTemplateService.deleteLibrary(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, libraryId: id }, 'Failed to delete library');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ libraryId: id }, 'Library deleted');
    res.status(204).send();
  }

  // ===== Templates =====

  static async listTemplates(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as CodeTemplateListQuery;
    const result = await CodeTemplateService.listTemplates(query.libraryId);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list templates');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async createTemplate(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateCodeTemplateInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CodeTemplateService.createTemplate(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, name: input.name }, 'Failed to create template');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ templateId: result.value.id }, 'Template created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async updateTemplate(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateCodeTemplateInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CodeTemplateService.updateTemplate(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, templateId: id }, 'Failed to update template');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ templateId: id }, 'Template updated');
    res.json({ success: true, data: result.value });
  }

  static async deleteTemplate(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await CodeTemplateService.deleteTemplate(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, templateId: id }, 'Failed to delete template');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ templateId: id }, 'Template deleted');
    res.status(204).send();
  }
}
