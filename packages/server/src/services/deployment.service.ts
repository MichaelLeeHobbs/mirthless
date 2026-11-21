import { tryCatch, type Result } from 'stderr-lib';
import { CHANNEL_STATE, EVENT_NAME, SOCKET_EVENT, type ChannelState } from '@galvanigraph/core-models';
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
import { errorInfo } from '@galvanigraph/core-util';
import { assertScriptsTypeCheck } from './script-type-gate.service.js';
import { DeploymentRecordService, type DeploymentBundle, type RecordedDeployment } from './deployment-record.service.js';

/**
 * Runs before anything is torn down, so a refused redeploy leaves the channel running.
 * Results are cached, so a redeploy's second check costs nothing.
 */
async function typeCheckChannel(bundle: DeploymentBundle): Promise<void> {
  await assertScriptsTypeCheck(bundle.channel, bundle.templates);
}

interface DeployBundleOptions {
  /**
   * Refuse a channel with TypeScript type errors. The startup redeploy does
   * not check: a channel that was running must come back after a restart.
   */
  readonly typeCheck: boolean;
  /**
   * Record the bundle as the channel's deployment. A deploy someone asked for
   * does; the startup redeploy, which runs what is already recorded, does not.
   */
  readonly record: boolean;
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

/**
 * A Channel Reader source gets its own channel id, which it registers itself under.
 * The record keeps the unresolved channel: map values can be secrets, and are
 * server settings read at every deploy.
 */
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

function validateConnectors(channel: ChannelDetail): void {
  const srcValidation = validateConnectorProperties(channel.sourceConnectorType, 'source', channel.sourceConnectorProperties);
  if (!srcValidation.ok) {
    throw new ServiceError('INVALID_INPUT', srcValidation.error.message);
  }
  for (const dest of channel.destinations) {
    const destValidation = validateConnectorProperties(dest.connectorType, 'destination', dest.properties);
    if (!destValidation.ok) {
      throw new ServiceError(
        'INVALID_INPUT',
        `Destination "${dest.name}" (metaDataId ${String(dest.metaDataId)}): ${destValidation.error.message}`,
      );
    }
  }
}

/** The channel, its code templates and the global scripts as saved now, read together. */
async function loadSaved(channelId: string): Promise<DeploymentBundle> {
  const bundle = await DeploymentRecordService.loadSaved(channelId);
  if (!bundle.ok) throw bundle.error;
  if (!bundle.value.channel.enabled) {
    throw new ServiceError('CONFLICT', 'Cannot deploy a disabled channel. Enable it first.');
  }
  return bundle.value;
}

/**
 * Record what was just deployed. A channel running something the record does
 * not hold would come back different after a restart, so when the record
 * cannot be written the deploy is undone and fails.
 */
async function recordOrUndo(bundle: DeploymentBundle, context: AuditContext | undefined): Promise<void> {
  const recorded = await DeploymentRecordService.record(bundle, context?.userId ?? null);
  if (recorded.ok) return;
  const channelId = bundle.channel.id;
  logger.error({ channelId, ...errorInfo(recorded.error) }, 'Could not record a deployment; undeploying the channel');
  const undone = await tryCatch(() => getEngine().undeploy(channelId));
  if (!undone.ok) {
    logger.error({ channelId, ...errorInfo(undone.error) }, 'Could not undeploy a channel whose deployment was not recorded');
    throw new ServiceError('INTERNAL', `The deployment could not be recorded, and the channel could not be undeployed: it is deployed and stopped, and a restart would not run this version. Undeploy it. ${recorded.error.message}`);
  }
  emitStateChange(channelId, CHANNEL_STATE.UNDEPLOYED);
  throw new ServiceError('INTERNAL', `Channel was not deployed: the deployment could not be recorded, so a restart would not run it. ${recorded.error.message}`);
}

/** The deploy, undeploy or redeploy of each channel in progress, as the tail of a queue. */
const channelQueues = new Map<string, Promise<unknown>>();

/**
 * Run `fn` once every earlier deploy, undeploy or redeploy of the same channel
 * has finished, so the running channel and its deployment record change
 * together: an undeploy cannot land between a deploy and its record, and the
 * startup redeploy cannot bring back a version someone replaced meanwhile.
 */
async function serialized<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
  const previous = channelQueues.get(channelId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  channelQueues.set(channelId, tail);
  try {
    return await run;
  } finally {
    if (channelQueues.get(channelId) === tail) channelQueues.delete(channelId);
  }
}

/** Start (and pause) a just-deployed channel as its initial state asks. */
async function applyInitialState(channel: ChannelDetail, context: AuditContext | undefined): Promise<ChannelState> {
  const deployed = getEngine().getRuntime(channel.id);
  const currentState = (deployed?.runtime.getState() ?? 'STOPPED') as ChannelState;
  if ((channel.initialState !== 'STARTED' && channel.initialState !== 'PAUSED') || currentState !== 'STOPPED') {
    return currentState;
  }
  // Fail loud: a channel set to start on deploy that cannot start (a port
  // in use, an unreachable host) must not report a successful deploy.
  const startResult = await DeploymentService.start(channel.id, context);
  if (!startResult.ok) throw notRunning('deployed', channel.id, startResult.error);
  if (channel.initialState !== 'PAUSED') return CHANNEL_STATE.STARTED;
  const pauseResult = await DeploymentService.pause(channel.id, context);
  if (!pauseResult.ok) throw pauseResult.error;
  return CHANNEL_STATE.PAUSED;
}

/** Deploy a bundle: validate, compile, run it, record it if asked, and apply the initial state. */
async function deployBundle(bundle: DeploymentBundle, context: AuditContext | undefined, options: DeployBundleOptions): Promise<ChannelStatus> {
  const channelId = bundle.channel.id;
  const engine = getEngine();
  if (engine.getRuntime(channelId)) {
    throw new ServiceError('CONFLICT', `Channel ${channelId} is already deployed`);
  }
  const deployChannel = await withConfigReferences(bundle.channel);
  validateConnectors(deployChannel);
  if (options.typeCheck) await typeCheckChannel(bundle);

  await engine.deploy({ ...bundle, channel: deployChannel });
  // Recorded before the start: a channel that deployed but would not start is
  // still deployed, and a restart must bring back this version of it.
  if (options.record) await recordOrUndo(bundle, context);

  emitEvent({
    level: 'INFO', name: EVENT_NAME.CHANNEL_DEPLOYED, outcome: 'SUCCESS',
    userId: context?.userId ?? null, channelId,
    serverId: null, ipAddress: context?.ipAddress ?? null,
    attributes: { revision: bundle.channel.revision, ...(options.record ? {} : { restart: true }) },
  });

  const finalState = await applyInitialState(bundle.channel, context);
  emitStateChange(channelId, finalState);
  return { channelId, state: finalState };
}

function assertUndeployable(channelId: string): void {
  const state = getDeployed(channelId).runtime.getState();
  if (state !== 'STOPPED') {
    throw new ServiceError('CONFLICT', `Cannot undeploy: channel is ${state}. Stop it first.`);
  }
}

/** Set or clear the record's undeployed mark, failing loud when it cannot be written. */
async function markUndeployed(channelId: string, undeployed: boolean): Promise<void> {
  const marked = await DeploymentRecordService.markUndeployed(channelId, undeployed);
  if (!marked.ok) {
    throw new ServiceError('INTERNAL', `Channel was not undeployed: the server could not record it, so a restart would bring it back. ${marked.error.message}`);
  }
}

/**
 * Undeploy a channel that is not running: mark its record so a restart leaves
 * it off. Only a record a restart would deploy can be marked; otherwise the
 * channel is simply not deployed (NOT_FOUND).
 */
async function markRecordOnly(channelId: string, context: AuditContext | undefined): Promise<ChannelStatus> {
  const recorded = await DeploymentRecordService.listRecorded([channelId]);
  if (!recorded.ok) throw recorded.error;
  const record = recorded.value.get(channelId);
  if (record === undefined || record.kind === 'undeployed') {
    throw new ServiceError('NOT_FOUND', `Channel ${channelId} is not deployed`);
  }
  await markUndeployed(channelId, true);
  emitEvent({
    level: 'INFO', name: EVENT_NAME.CHANNEL_UNDEPLOYED, outcome: 'SUCCESS',
    userId: context?.userId ?? null, channelId,
    serverId: null, ipAddress: context?.ipAddress ?? null, attributes: { recordOnly: true },
  });
  return { channelId, state: CHANNEL_STATE.UNDEPLOYED };
}

/** Shut the channel's runtime down and remove it, leaving its deployment record alone. */
async function undeployRuntime(channelId: string, context: AuditContext | undefined): Promise<ChannelStatus> {
  assertUndeployable(channelId);
  await getEngine().undeploy(channelId);

  emitEvent({
    level: 'INFO', name: EVENT_NAME.CHANNEL_UNDEPLOYED, outcome: 'SUCCESS',
    userId: context?.userId ?? null, channelId,
    serverId: null, ipAddress: context?.ipAddress ?? null, attributes: null,
  });

  emitStateChange(channelId, CHANNEL_STATE.UNDEPLOYED);
  return { channelId, state: CHANNEL_STATE.UNDEPLOYED };
}

export class DeploymentService {
  /**
   * Deploy a channel as saved now, with the code templates and global scripts
   * as saved now, and record that as its deployment: what a restart runs.
   */
  static async deploy(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(() => serialized(channelId, async () => {
      if (getEngine().getRuntime(channelId)) {
        throw new ServiceError('CONFLICT', `Channel ${channelId} is already deployed`);
      }
      const bundle = await loadSaved(channelId);
      return deployBundle(bundle, context, { typeCheck: true, record: true });
    }));
  }

  /**
   * Undeploy a channel (shuts down and removes runtime). Its deployment record
   * is marked first, so a restart leaves it undeployed; when the record cannot
   * be marked, nothing is undeployed. A channel that is not running but would
   * come back at a restart (its redeploy failed after the old version stopped)
   * is only marked, so it can be kept off.
   */
  static async undeploy(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(() => serialized(channelId, async () => {
      if (!getEngine().getRuntime(channelId)) return markRecordOnly(channelId, context);
      assertUndeployable(channelId);
      await markUndeployed(channelId, true);
      try {
        return await undeployRuntime(channelId, context);
      } catch (err) {
        const cleared = await DeploymentRecordService.markUndeployed(channelId, false);
        if (!cleared.ok) logger.error({ channelId, ...errorInfo(cleared.error) }, 'Undeploy failed and its mark could not be cleared; a restart will not redeploy this channel');
        throw err;
      }
    }));
  }

  /**
   * Saved edits reach a deployed channel only through a redeploy. Keeps the prior
   * runtime state. The saved configuration is read once, so what is checked is
   * what deploys and is recorded. When the new version fails to deploy, the
   * record still holds the old one, and a restart brings that back.
   */
  static async redeploy(channelId: string, context?: AuditContext): Promise<Result<ChannelStatus>> {
    return tryCatch(() => serialized(channelId, async () => {
      const engine = getEngine();
      const existing = engine.getRuntime(channelId);
      const priorState: ChannelState = (existing?.runtime.getState() ?? 'UNDEPLOYED') as ChannelState;
      const bundle = await loadSaved(channelId);

      if (existing) {
        // Compile the saved configuration BEFORE touching the running channel.
        // A script that does not compile then fails the redeploy and the
        // channel keeps running on its current configuration.
        await engine.checkScripts(bundle);
        await typeCheckChannel(bundle);

        if (priorState === 'STARTED' || priorState === 'PAUSED') {
          const stopResult = await DeploymentService.stop(channelId, context);
          if (!stopResult.ok) throw stopResult.error;
        }
        await undeployRuntime(channelId, context);
      }

      const deployed = await deployBundle(bundle, context, { typeCheck: true, record: true });
      return { channelId, state: await restoreState(channelId, priorState, deployed.state, context) };
    }));
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
   * Redeploys each enabled channel's recorded deployment, never the saved
   * configuration, so an edit nobody deployed does not go live at a restart (#225).
   * Not redeployed: a channel someone undeployed, and one never deployed (audited).
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
      const notAdopted = new Set(await adoptPendingChannels(channels));
      const failedNames = channels.filter((ch) => notAdopted.has(ch.id)).map((ch) => ch.name);
      logger.info({
        total: allChannels.length,
        enabled: channels.length,
        channels: channels.map((ch) => ({ id: ch.id, name: ch.name })),
      }, 'Redeploying the recorded deployments of enabled channels');

      // The API is already serving: each channel's record is read just before
      // it deploys, in turn with any deploy or undeploy of it made meanwhile.
      for (const ch of channels) {
        if (notAdopted.has(ch.id)) continue;
        if (!(await serialized(ch.id, () => redeployLatestRecord(ch)))) failedNames.push(ch.name);
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

/** A deploy follows initialState, which may differ from the prior state. */
async function restoreState(channelId: string, priorState: ChannelState, state: ChannelState, context: AuditContext | undefined): Promise<ChannelState> {
  if (priorState === 'STARTED' && state !== 'STARTED') {
    const r = await DeploymentService.start(channelId, context);
    if (!r.ok) throw notRunning('redeployed', channelId, r.error);
    return r.value.state;
  }
  if (priorState === 'PAUSED' && state !== 'PAUSED') {
    if (state !== 'STARTED') {
      const started = await DeploymentService.start(channelId, context);
      if (!started.ok) throw notRunning('redeployed', channelId, started.error);
    }
    const p = await DeploymentService.pause(channelId, context);
    if (!p.ok) throw p.error;
    return p.value.state;
  }
  return state;
}

function emitNotRedeployed(ch: ChannelDeployEntry, level: 'WARN' | 'ERROR', reason: string): void {
  emitEvent({
    level, name: EVENT_NAME.CHANNEL_NOT_REDEPLOYED, outcome: level === 'ERROR' ? 'FAILURE' : 'SUCCESS',
    userId: null, channelId: ch.id, serverId: null, ipAddress: null,
    attributes: { channelName: ch.name, reason },
  });
}

/**
 * At startup, redeploy a channel from its record as it is now. A channel someone
 * deployed since the server started is left as it is. Returns false when the
 * record cannot be read or the channel fails to deploy.
 */
async function redeployLatestRecord(ch: ChannelDeployEntry): Promise<boolean> {
  if (getEngine().getRuntime(ch.id)) {
    logger.info({ channelId: ch.id, channelName: ch.name }, 'Channel was deployed while the server was starting; leaving it as it is');
    return true;
  }
  const recorded = await DeploymentRecordService.listRecorded([ch.id]);
  if (!recorded.ok) {
    logger.error({ channelId: ch.id, channelName: ch.name, ...errorInfo(recorded.error) }, 'Could not read the channel\'s deployment record');
    return false;
  }
  return redeployRecorded(ch, recorded.value.get(ch.id));
}

/**
 * Redeploy one enabled channel from its record at startup. Returns false when
 * the channel should be running and is not (a failed deploy, an unreadable
 * record); true when it deployed or, by design, was not redeployed.
 */
async function redeployRecorded(ch: ChannelDeployEntry, recorded: RecordedDeployment | undefined): Promise<boolean> {
  if (recorded === undefined) {
    logger.warn({ channelId: ch.id, channelName: ch.name }, 'Enabled channel was never deployed, so it was not deployed at startup');
    emitNotRedeployed(ch, 'WARN', 'It has never been deployed. Deploy it to run it.');
    return true;
  }
  if (recorded.kind === 'undeployed') {
    logger.info({ channelId: ch.id, channelName: ch.name }, 'Channel was undeployed before the restart, so it stays undeployed');
    return true;
  }
  if (recorded.kind === 'unreadable') {
    logger.error({ channelId: ch.id, channelName: ch.name, reason: recorded.reason }, 'Channel was not redeployed: its deployment record cannot be read');
    emitNotRedeployed(ch, 'ERROR', `Not redeployed: ${recorded.reason}. Deploy it again.`);
    return false;
  }
  const result = await tryCatch(() => deployBundle(recorded.bundle, undefined, { typeCheck: false, record: false }));
  if (!result.ok) {
    logger.error({ channelId: ch.id, channelName: ch.name, ...errorInfo(result.error) }, 'Failed to redeploy channel');
    return false;
  }
  logger.info({ channelId: ch.id, channelName: ch.name, revision: recorded.bundle.channel.revision, state: result.value.state }, 'Redeployed channel');
  return true;
}

/**
 * First start after the upgrade that added deployment records (D-328): record
 * each enabled channel's saved configuration as its deployment, once, so it
 * comes back as it did before the upgrade. Channels no longer enabled are
 * dropped from the list. Returns the ids of channels that could not be adopted.
 */
async function adoptPendingChannels(channels: readonly ChannelDeployEntry[]): Promise<string[]> {
  const pending = await DeploymentRecordService.listPendingAdoptions();
  if (!pending.ok) throw pending.error;
  if (pending.value.size === 0) return [];
  const enabledIds = new Set(channels.map((ch) => ch.id));
  const dropped = await DeploymentRecordService.dropAdoptions([...pending.value].filter((id) => !enabledIds.has(id)));
  if (!dropped.ok) throw dropped.error;

  const failed: string[] = [];
  for (const ch of channels.filter((c) => pending.value.has(c.id))) {
    // In turn with a deploy of the same channel, so adoption never overwrites one.
    const adopted = await serialized(ch.id, () => DeploymentRecordService.adoptSaved(ch.id));
    if (!adopted.ok) {
      logger.error({ channelId: ch.id, channelName: ch.name, ...errorInfo(adopted.error) }, 'Could not record the saved configuration as the channel\'s deployment');
      failed.push(ch.id);
    } else if (adopted.value !== null) {
      logger.warn({ channelId: ch.id, channelName: ch.name, revision: adopted.value.channel.revision }, 'Upgrade: recorded the saved configuration as the channel\'s deployment');
      emitEvent({
        level: 'WARN', name: EVENT_NAME.CHANNEL_DEPLOYMENT_ADOPTED, outcome: 'SUCCESS',
        userId: null, channelId: ch.id, serverId: null, ipAddress: null,
        attributes: { channelName: ch.name, revision: adopted.value.channel.revision },
      });
    }
  }
  return failed;
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
