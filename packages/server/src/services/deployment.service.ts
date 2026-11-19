import { tryCatch, type Result } from 'stderr-lib';
import { CHANNEL_STATE, SOCKET_EVENT, type ChannelState } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { emitToChannelAudience } from '../lib/socket.js';
import { ChannelService, type ChannelDetail, type ChannelDeployEntry } from './channel.service.js';
import { ChannelDependencyService, orderByDependencies } from './channel-dependency.service.js';
import { validateConnectorProperties } from './connector-validation.service.js';
import { ConfigMapService } from './config-map.service.js';
import { configLookup, resolveConfigReferences } from '../lib/config-references.js';
import { getEngine } from '../engine.js';
import type { DeployedChannel, SourceDispatchOutcome } from '../engine.js';
import logger from '../lib/logger.js';
import { CodeTemplateService } from './code-template.service.js';
import { assertScriptsTypeCheck } from './script-type-gate.service.js';

/**
 * Runs before anything is torn down, so a refused redeploy leaves the channel running.
 * Results are cached, so a redeploy's second check costs nothing.
 */
async function typeCheckChannel(channel: ChannelDetail): Promise<void> {
  const templates = await CodeTemplateService.listTemplatesForChannel(channel.id);
  if (!templates.ok) throw templates.error;
  await assertScriptsTypeCheck(channel, templates.value);
}

export interface DeployOptions {
  /**
   * Default true. Startup auto-deploy turns it off: a channel that was running must come
   * back after a restart.
   */
  readonly typeCheck?: boolean;
}

export interface ChannelStatus {
  readonly channelId: string;
  readonly state: ChannelState;
}

function emitStateChange(channelId: string, state: ChannelState): void {
  emitToChannelAudience(channelId, SOCKET_EVENT.CHANNEL_STATE, { channelId, state });
}

/** The channel stays deployed and stopped, so it can be started once the cause is fixed. */
function notRunning(action: 'deployed' | 'redeployed', channelId: string, cause: Error): ServiceError {
  logger.error({ channelId, errMsg: cause.message }, `Channel was ${action} but could not start`);
  emitStateChange(channelId, CHANNEL_STATE.STOPPED);
  return new ServiceError('CONFLICT', `Channel was ${action} but is stopped. ${cause.message}`);
}

/** A Channel Reader source gets its own channel id, which it registers itself under. */
async function withConfigReferences(channel: ChannelDetail): Promise<ChannelDetail> {
  const entries = await ConfigMapService.list();
  if (!entries.ok) throw new ServiceError('INTERNAL', `Could not load the configuration map: ${entries.error.message}`);
  const lookup = configLookup(entries.value);
  const sourceProps = resolveConfigReferences(channel.sourceConnectorProperties, lookup);
  return {
    ...channel,
    sourceConnectorProperties: channel.sourceConnectorType === 'CHANNEL' ? { ...sourceProps, channelId: channel.id } : sourceProps,
    destinations: channel.destinations.map((d) => ({ ...d, properties: resolveConfigReferences(d.properties, lookup) })),
  };
}

export class DeploymentService {
  static async deploy(channelId: string, context?: AuditContext, options: DeployOptions = {}): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const channelResult = await ChannelService.getById(channelId);
      if (!channelResult.ok) {
        throw new ServiceError('NOT_FOUND', `Channel not found: ${channelId}`);
      }

      const channel = channelResult.value;

      if (!channel.enabled) {
        throw new ServiceError('CONFLICT', 'Cannot deploy a disabled channel. Enable it first.');
      }

      const engine = getEngine();
      const existing = engine.getRuntime(channelId);
      if (existing) {
        throw new ServiceError('CONFLICT', `Channel ${channelId} is already deployed`);
      }

      const deployChannel = await withConfigReferences(channel);

      const srcValidation = validateConnectorProperties(
        deployChannel.sourceConnectorType, 'source', deployChannel.sourceConnectorProperties,
      );
      if (!srcValidation.ok) {
        throw new ServiceError('INVALID_INPUT', srcValidation.error.message);
      }

      for (const dest of deployChannel.destinations) {
        const destValidation = validateConnectorProperties(
          dest.connectorType, 'destination', dest.properties,
        );
        if (!destValidation.ok) {
          throw new ServiceError(
            'INVALID_INPUT',
            `Destination "${dest.name}" (metaDataId ${String(dest.metaDataId)}): ${destValidation.error.message}`,
          );
        }
      }

      if (options.typeCheck !== false) await typeCheckChannel(channel);

      await engine.deploy(deployChannel);

      emitEvent({
        level: 'INFO', name: 'CHANNEL_DEPLOYED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
      });

      const deployed = engine.getRuntime(channelId);
      const currentState = deployed?.runtime.getState() ?? 'STOPPED';
      let finalState: ChannelState = currentState as ChannelState;
      if ((channel.initialState === 'STARTED' || channel.initialState === 'PAUSED') && currentState === 'STOPPED') {
        // Fail loud: a channel set to start on deploy that cannot start (a port
        // in use, an unreachable host) must not report a successful deploy.
        const startResult = await DeploymentService.start(channelId, context);
        if (!startResult.ok) throw notRunning('deployed', channelId, startResult.error);
        finalState = CHANNEL_STATE.STARTED;
        if (channel.initialState === 'PAUSED') {
          const pauseResult = await DeploymentService.pause(channelId, context);
          if (!pauseResult.ok) throw pauseResult.error;
          finalState = CHANNEL_STATE.PAUSED;
        }
      }

      emitStateChange(channelId, finalState);

      return { channelId, state: finalState };
    });
  }

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

  /** Saved edits reach a deployed channel only through a redeploy. Keeps the prior runtime state. */
  static async redeploy(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const engine = getEngine();
      const existing = engine.getRuntime(channelId);
      const priorState: ChannelState = (existing?.runtime.getState() ?? 'UNDEPLOYED') as ChannelState;

      if (existing) {
        // Compile the saved configuration BEFORE touching the running channel.
        // A script that does not compile then fails the redeploy and the
        // channel keeps running on its current configuration.
        const saved = await ChannelService.getById(channelId);
        if (!saved.ok) throw new ServiceError('NOT_FOUND', `Channel not found: ${channelId}`);
        await engine.checkScripts(saved.value);
        await typeCheckChannel(saved.value);

        if (priorState === 'STARTED' || priorState === 'PAUSED') {
          const stopResult = await DeploymentService.stop(channelId, context);
          if (!stopResult.ok) throw stopResult.error;
        }
        const undeployResult = await DeploymentService.undeploy(channelId, context);
        if (!undeployResult.ok) throw undeployResult.error;
      }

      const deployResult = await DeploymentService.deploy(channelId, context);
      if (!deployResult.ok) throw deployResult.error;

      // deploy() follows initialState, which may differ from the prior state.
      let state = deployResult.value.state;
      if (priorState === 'STARTED' && state !== 'STARTED') {
        const r = await DeploymentService.start(channelId, context);
        if (!r.ok) throw notRunning('redeployed', channelId, r.error);
        state = r.value.state;
      } else if (priorState === 'PAUSED' && state !== 'PAUSED') {
        if (state !== 'STARTED') {
          const started = await DeploymentService.start(channelId, context);
          if (!started.ok) throw notRunning('redeployed', channelId, started.error);
        }
        const p = await DeploymentService.pause(channelId, context);
        if (!p.ok) throw p.error;
        state = p.value.state;
      }

      return { channelId, state };
    });
  }

  static async start(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      const result = await deployed.runtime.start();
      if (!result.ok) {
        throw new ServiceError('CONFLICT', `Cannot start channel: ${result.error.message}`);
      }

      // Start queue consumers after runtime starts, and only once claims left
      // by a server stop have been released.
      await deployed.resetClaimsOnce();
      deployed.queueConsumers.forEach((c) => c.start());

      // Crash recovery needs started destination dispatchers, so it runs here
      // (once per deploy), not at deploy time. It runs in the background: a
      // large backlog must not hold up the start, and the channel is already
      // taking new messages. Recovery logs its own failures.
      void deployed.recoverOnce().catch((err: unknown) => {
        logger.error({ channelId, errMsg: err instanceof Error ? err.message : String(err) }, 'Channel recovery failed');
      });

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

  static async stop(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);

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

  static async halt(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);

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

  /** Stops the source only. */
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

  static async getStatus(channelId: string): Promise<Result<ChannelStatus>> {
    return tryCatch(async () => {
      const deployed = getDeployed(channelId);
      return { channelId, state: deployed.runtime.getState() };
    });
  }

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
   * If the dependencies can't be loaded, nothing deploys: a safe order can't be proven.
   * A channel that fails to deploy does not stop the others.
   */
  static async autoDeployChannels(): Promise<Result<void>> {
    return tryCatch(async () => {
      const allChannels = await listAllChannels();
      const channels = await orderForDeploy(allChannels.filter((ch) => ch.enabled));
      if (channels === null) {
        throw new ServiceError('INTERNAL', 'Channel dependencies could not be loaded, so no channel was redeployed');
      }
      logger.info({
        total: allChannels.length,
        enabled: channels.length,
        channels: channels.map((ch) => ({ id: ch.id, name: ch.name })),
      }, 'Auto-deploying enabled channels');

      const failedNames: string[] = [];
      for (const ch of channels) {
        const deployResult = await DeploymentService.deploy(ch.id, undefined, { typeCheck: false });
        if (!deployResult.ok) {
          logger.error({ channelId: ch.id, channelName: ch.name, errMsg: deployResult.error.message }, 'Failed to auto-deploy channel');
          failedNames.push(ch.name);
          continue;
        }
        logger.info({ channelId: ch.id, channelName: ch.name, state: deployResult.value.state }, 'Auto-deployed channel');
      }
      if (failedNames.length > 0) {
        throw new ServiceError('INTERNAL', `${failedNames.length} of ${channels.length} channels failed to redeploy: ${failedNames.join(', ')}`);
      }
    });
  }

  /** NOT_FOUND when not deployed; CONFLICT when not STARTED or the message could not be processed. */
  static async sendMessage(channelId: string, content: string): Promise<Result<SourceDispatchOutcome>> {
    return getEngine().sendMessage(channelId, content);
  }
}

/** Kept once per id (names are not unique), so no channel is deployed twice or skipped. */
async function listAllChannels(): Promise<readonly ChannelDeployEntry[]> {
  const result = await ChannelService.listLiveForDeploy();
  if (!result.ok) throw result.error;
  return [...new Map(result.value.map((ch) => [ch.id, ch])).values()];
}

/** null, already logged, when the dependency edges can't load. */
async function orderForDeploy<T extends { readonly id: string }>(channels: readonly T[]): Promise<readonly T[] | null> {
  const edgesResult = await ChannelDependencyService.listAll();
  if (!edgesResult.ok) {
    logger.error(
      { errMsg: edgesResult.error.message, channelCount: channels.length },
      'Failed to load channel dependencies; skipping auto-deploy. Deploy channels manually once the database is reachable.',
    );
    return null;
  }
  const byId = new Map(channels.map((ch) => [ch.id, ch]));
  return orderByDependencies(channels.map((ch) => ch.id), edgesResult.value)
    .map((id) => byId.get(id))
    .filter((ch): ch is T => ch !== undefined);
}

function getDeployed(channelId: string): DeployedChannel {
  const engine = getEngine();
  const deployed = engine.getRuntime(channelId);
  if (!deployed) {
    throw new ServiceError('NOT_FOUND', `Channel ${channelId} is not deployed`);
  }
  return deployed;
}
