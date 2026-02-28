// ===========================================
// Deployment Service
// ===========================================
// Orchestrates channel deployment, start, stop, and status.
// All methods return Result<T> via tryCatch.

import { tryCatch, type Result } from 'stderr-lib';
import { ServiceError } from '../lib/service-error.js';
import { ChannelService } from './channel.service.js';
import { getEngine } from '../engine.js';

// ----- Types -----

export interface ChannelStatus {
  readonly channelId: string;
  readonly state: string;
}

// ----- Service -----

export class DeploymentService {
  /** Deploy a channel (loads config and initializes connectors). */
  static async deploy(channelId: string): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const channelResult = await ChannelService.getById(channelId);
      if (!channelResult.ok) {
        throw new ServiceError('NOT_FOUND', `Channel not found: ${channelId}`);
      }

      const engine = getEngine();
      const existing = engine.getRuntime(channelId);
      if (existing) {
        throw new ServiceError('CONFLICT', `Channel ${channelId} is already deployed`);
      }

      await engine.deploy(channelResult.value);

      return { channelId, state: 'STOPPED' };
    });
  }

  /** Undeploy a channel (shuts down and removes runtime). */
  static async undeploy(channelId: string): Promise<Result<ChannelStatus>> {
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
      return { channelId, state: 'UNDEPLOYED' };
    });
  }

  /** Start a deployed channel. */
  static async start(channelId: string): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.start();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to start channel');
      }
      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Stop a running channel gracefully. */
  static async stop(channelId: string): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.stop();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to stop channel');
      }
      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Force-stop a running channel. */
  static async halt(channelId: string): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.halt();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to halt channel');
      }
      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Pause a running channel (stop source only). */
  static async pause(channelId: string): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.pause();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to pause channel');
      }
      return { channelId, state: deployed.runtime.getState() };
    });
  }

  /** Resume a paused channel. */
  static async resume(channelId: string): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.resume();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', 'Failed to resume channel');
      }
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

function getDeployed(channelId: string): { runtime: { getState(): string; start(): Promise<Result<void>>; stop(): Promise<Result<void>>; halt(): Promise<Result<void>>; pause(): Promise<Result<void>>; resume(): Promise<Result<void>> } } {
  const engine = getEngine();
  const deployed = engine.getRuntime(channelId);
  if (!deployed) {
    throw new ServiceError('NOT_FOUND', `Channel ${channelId} is not deployed`);
  }
  return deployed;
}
