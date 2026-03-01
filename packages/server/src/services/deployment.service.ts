// ===========================================
// Deployment Service
// ===========================================
// Orchestrates channel deployment, start, stop, and status.
// All methods return Result<T> via tryCatch.

import { tryCatch, type Result } from 'stderr-lib';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { ChannelService } from './channel.service.js';
import { validateConnectorProperties } from './connector-validation.service.js';
import { getEngine } from '../engine.js';
import type { DeployedChannel } from '../engine.js';

// ----- Types -----

export interface ChannelStatus {
  readonly channelId: string;
  readonly state: string;
}

// ----- Service -----

export class DeploymentService {
  /** Deploy a channel (loads config and initializes connectors). */
  static async deploy(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const channelResult = await ChannelService.getById(channelId);
      if (!channelResult.ok) {
        throw new ServiceError('NOT_FOUND', `Channel not found: ${channelId}`);
      }

      const channel = channelResult.value;

      const engine = getEngine();
      const existing = engine.getRuntime(channelId);
      if (existing) {
        throw new ServiceError('CONFLICT', `Channel ${channelId} is already deployed`);
      }

      // Validate source connector properties
      const srcValidation = validateConnectorProperties(
        channel.sourceConnectorType, 'source', channel.sourceConnectorProperties,
      );
      if (!srcValidation.ok) {
        throw new ServiceError('INVALID_INPUT', srcValidation.error.message);
      }

      // Validate each destination's connector properties
      for (const dest of channel.destinations) {
        const destValidation = validateConnectorProperties(
          dest.connectorType, 'destination', dest.properties,
        );
        if (!destValidation.ok) {
          throw new ServiceError('INVALID_INPUT', destValidation.error.message);
        }
      }

      await engine.deploy(channel);

      emitEvent({
        level: 'INFO', name: 'CHANNEL_DEPLOYED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      return { channelId, state: 'STOPPED' };
    });
  }

  /** Undeploy a channel (shuts down and removes runtime). */
  static async undeploy(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const engine = getEngine();
      const deployed = engine.getRuntime(channelId);
      if (!deployed) {
        throw new ServiceError('NOT_FOUND', `Channel ${channelId} is not deployed`);
      }

      const state = deployed.runtime.getState();
      if (state !== 'STOPPED') {
        throw new ServiceError('CONFLICT', `Cannot undeploy: channel is ${state}. Stop it first.`);
      }

      await engine.undeploy(channelId);

      emitEvent({
        level: 'INFO', name: 'CHANNEL_UNDEPLOYED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      return { channelId, state: 'UNDEPLOYED' };
    });
  }

  /** Start a deployed channel. */
  static async start(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.start();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to start channel');
      }

      // Start queue consumers after runtime starts
      deployed.queueConsumers.forEach((c) => c.start());

      emitEvent({
        level: 'INFO', name: 'CHANNEL_STARTED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Stop a running channel gracefully. */
  static async stop(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);

      // Stop queue consumers before stopping runtime
      await Promise.all(deployed.queueConsumers.map((c) => c.stop()));

      const result = await deployed.runtime.stop();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to stop channel');
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_STOPPED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Force-stop a running channel. */
  static async halt(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);

      // Stop queue consumers before halting runtime
      await Promise.all(deployed.queueConsumers.map((c) => c.stop()));

      const result = await deployed.runtime.halt();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to halt channel');
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_STOPPED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: { method: 'halt' },
      });

      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Pause a running channel (stop source only). */
  static async pause(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.pause();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to pause channel');
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_PAUSED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Resume a paused channel. */
  static async resume(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.resume();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to resume channel');
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_STARTED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: { method: 'resume' },
      });

      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Get status of a single deployed channel. */
  static async getStatus(channelId: string): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Get status of all deployed channels. */
  static async getAllStatuses(): Promise<Result<readonly ChannelStatus[]>> {
    return tryCatch(async () => {
      const engine = getEngine();
      const statuses: ChannelStatus[] = [];
      for (const [channelId, deployed] of engine.getAll()) {
        statuses.push({ channelId, state: deployed.runtime.getState() });
      }
      return statuses;
    });
  }
}

// ----- Helper -----

function getDeployed(channelId: string): DeployedChannel {
  const engine = getEngine();
  const deployed = engine.getRuntime(channelId);
  if (!deployed) {
    throw new ServiceError('NOT_FOUND', `Channel ${channelId} is not deployed`);
  }
  return deployed;
}
