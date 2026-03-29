// ===========================================
// Deployment Controller
// ===========================================
// HTTP adapter for channel deployment operations.

import type { Request, Response } from 'express';
import { DeploymentService } from '../services/deployment.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';

export class DeploymentController {
  static async deploy(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DeploymentService.deploy(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to deploy channel');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id }, 'Channel deployed');
    res.json({ success: true, data: result.value });
  }

  static async undeploy(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DeploymentService.undeploy(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id }, 'Channel undeployed');
    res.json({ success: true, data: result.value });
  }

  static async start(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DeploymentService.start(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id }, 'Channel started');
    res.json({ success: true, data: result.value });
  }

  static async stop(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DeploymentService.stop(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id }, 'Channel stopped');
    res.json({ success: true, data: result.value });
  }

  static async halt(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DeploymentService.halt(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id }, 'Channel halted');
    res.json({ success: true, data: result.value });
  }

  static async pause(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DeploymentService.pause(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id }, 'Channel paused');
    res.json({ success: true, data: result.value });
  }

  static async resume(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await DeploymentService.resume(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id }, 'Channel resumed');
    res.json({ success: true, data: result.value });
  }

  static async getStatus(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await DeploymentService.getStatus(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getAllStatuses(_req: Request, res: Response): Promise<void> {
    const result = await DeploymentService.getAllStatuses();

    if (!result.ok) {
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async sendMessage(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const { content } = req.body as { content: string };
    const result = await DeploymentService.sendMessage(id, content);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to send message');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id, messageId: result.value.messageId }, 'Message sent');
    res.json({ success: true, data: result.value });
  }
}
