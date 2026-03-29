// ===========================================
// Deployment Service
// ===========================================
// Orchestrates channel deployment, start, stop, and status.
// All methods return Result<T> via tryCatch.

import { tryCatch, type Result } from 'stderr-lib';
import { CHANNEL_STATE, SOCKET_EVENT, type ChannelState } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { emitToAll } from '../lib/socket.js';
import { ChannelService } from './channel.service.js';
import { validateConnectorProperties } from './connector-validation.service.js';
import { getEngine } from '../engine.js';
import type { DeployedChannel } from '../engine.js';
import logger from '../lib/logger.js';

// ----- Types -----

export interface ChannelStatus {
  readonly channelId: string;
  readonly state: ChannelState;
}

// ----- Helpers -----

/** Emit a channel state change event to all connected sockets. */
function emitStateChange(channelId: string, state: ChannelState): void {
  emitToAll(SOCKET_EVENT.CHANNEL_STATE, { channelId, state });
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

      // Auto-inject channelId for CHANNEL source connectors (used for registry self-registration)
      const srcProps = channel.sourceConnectorType === 'CHANNEL'
        ? { ...channel.sourceConnectorProperties, channelId: channel.id }
        : channel.sourceConnectorProperties;

      // Validate source connector properties
      const srcValidation = validateConnectorProperties(
        channel.sourceConnectorType, 'source', srcProps,
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

      // Pass enriched source properties for CHANNEL connectors
      const deployChannel = channel.sourceConnectorType === 'CHANNEL'
        ? { ...channel, sourceConnectorProperties: { ...channel.sourceConnectorProperties, channelId: channel.id } }
        : channel;
      await engine.deploy(deployChannel);

      emitEvent({
        level: 'INFO', name: 'CHANNEL_DEPLOYED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      // Auto-start if channel's initialState calls for it (skip if already in target state)
      const deployed = engine.getRuntime(channelId);
      const currentState = deployed?.runtime.getState() ?? 'STOPPED';
      let finalState: ChannelState = currentState as ChannelState;
      if ((channel.initialState === 'STARTED' || channel.initialState === 'PAUSED') && currentState === 'STOPPED') {
        const startResult = await DeploymentService.start(channelId, context);
        if (startResult.ok) {
          finalState = CHANNEL_STATE.STARTED;
          if (channel.initialState === 'PAUSED') {
            const pauseResult = await DeploymentService.pause(channelId, context);
            if (pauseResult.ok) finalState = CHANNEL_STATE.PAUSED;
          }
        }
      }

      emitStateChange(channelId, finalState);

      return { channelId, state: finalState };
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

      emitStateChange(channelId, CHANNEL_STATE.UNDEPLOYED);

      return { channelId, state: CHANNEL_STATE.UNDEPLOYED };
    });
  }

  /** Start a deployed channel. */
  static async start(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.start();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', `Cannot start channel: ${result.error.message}`);
      }

      // Start queue consumers after runtime starts
      deployed.queueConsumers.forEach((c) => c.start());

      emitEvent({
        level: 'INFO', name: 'CHANNEL_STARTED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      const state = deployed.runtime.getState();
      emitStateChange(channelId, state);

      return { channelId, state };
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
        throw new ServiceError('CONFLICT', `Cannot stop channel: ${result.error.message}`);
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_STOPPED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      const state = deployed.runtime.getState();
      emitStateChange(channelId, state);

      return { channelId, state };
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
        throw new ServiceError('CONFLICT', `Cannot halt channel: ${result.error.message}`);
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_STOPPED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: { method: 'halt' },
      });

      const state = deployed.runtime.getState();
      emitStateChange(channelId, state);

      return { channelId, state };
    });
  }

  /** Pause a running channel (stop source only). */
  static async pause(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.pause();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', `Cannot pause channel: ${result.error.message}`);
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_PAUSED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      const state = deployed.runtime.getState();
      emitStateChange(channelId, state);

      return { channelId, state };
    });
  }

  /** Resume a paused channel. */
  static async resume(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.resume();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', `Cannot resume channel: ${result.error.message}`);
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_STARTED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: { method: 'resume' },
      });

      const state = deployed.runtime.getState();
      emitStateChange(channelId, state);

      return { channelId, state };
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

  /**
   * Auto-deploy all enabled channels on server startup.
   * Channels with initialState STARTED are deployed and started.
   * Channels with initialState PAUSED are deployed and started then paused.
   * Channels with initialState STOPPED are deployed only.
   */
  static async autoDeployChannels(): Promise<void> {
    const listResult = await ChannelService.list({ page: 1, pageSize: 1000 });
    if (!listResult.ok) {
      logger.error({ errMsg: listResult.error.message, stack: listResult.error.stack }, 'Failed to list channels for auto-deploy');
      return;
    }

    const channels = listResult.value.data.filter((ch) => ch.enabled);
    logger.info({ count: channels.length }, 'Auto-deploying enabled channels');

    for (const ch of channels) {
      const detailResult = await ChannelService.getById(ch.id);
      if (!detailResult.ok) {
        logger.warn({ channelId: ch.id, channelName: ch.name, errMsg: detailResult.error.message }, 'Skipping auto-deploy, failed to load channel');
        continue;
      }

      const detail = detailResult.value;
      const deployResult = await DeploymentService.deploy(ch.id);
      if (!deployResult.ok) {
        logger.warn({ channelId: ch.id, channelName: ch.name, errMsg: deployResult.error.message }, 'Failed to auto-deploy channel');
        continue;
      }

      if (detail.initialState === 'STARTED' || detail.initialState === 'PAUSED') {
        const startResult = await DeploymentService.start(ch.id);
        if (!startResult.ok) {
          logger.warn({ channelId: ch.id, channelName: ch.name, errMsg: startResult.error.message }, 'Failed to auto-start channel');
          continue;
        }
        if (detail.initialState === 'PAUSED') {
          await DeploymentService.pause(ch.id);
        }
      }

      logger.info({ channelId: ch.id, channelName: ch.name, state: detail.initialState }, 'Auto-deployed channel');
    }
  }

  /** Send a raw message to a deployed, started channel. */
  static async sendMessage(channelId: string, content: string): Promise<Result<{ messageId: number }>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const state = deployed.runtime.getState();
      if (state !== 'STARTED') {
        throw new ServiceError('CONFLICT', `Channel is ${state}, must be STARTED to receive messages`);
      }
      const result = await deployed.processMessage(content);
      if (!result.ok) {
        throw new ServiceError('CONFLICT', result.error.message);
      }
      return result.value;
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
