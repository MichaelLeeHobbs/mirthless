import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { CHANNEL_STATE } from '@galvanigraph/core-models';

type ChannelState = (typeof CHANNEL_STATE)[keyof typeof CHANNEL_STATE];

/** Matches the connectors package's lifecycle. */
export interface RuntimeConnector {
  onDeploy(): Promise<Result<void>>;
  onStart(): Promise<Result<void>>;
  onStop(): Promise<Result<void>>;
  onHalt(): Promise<Result<void>>;
  onUndeploy(): Promise<Result<void>>;
}

export interface RuntimeSourceConnector extends RuntimeConnector {
  setDispatcher(dispatcher: (raw: { content: string; sourceMap: Record<string, unknown> }) => Promise<Result<{ messageId: number; status?: 'PROCESSED' | 'FILTERED' | 'ERROR'; response?: string }>>): void;
}

export interface ChannelRuntimeConfig {
  readonly channelId: string;
  readonly source: RuntimeSourceConnector;
  readonly destinations: ReadonlyMap<number, RuntimeConnector>;
  readonly onMessage: (raw: { content: string; sourceMap: Record<string, unknown> }) => Promise<Result<{ messageId: number; status?: 'PROCESSED' | 'FILTERED' | 'ERROR'; response?: string; queued?: boolean; destinationFailed?: boolean }>>;
}

export class ChannelRuntime {
  private state: ChannelState = 'UNDEPLOYED';
  private config: ChannelRuntimeConfig | null = null;
  private abortController: AbortController | null = null;
  private runController: AbortController | null = null;
  private stopping: Promise<Result<void>> | null = null;
  private halting: Promise<Result<void>> | null = null;

  getState(): ChannelState {
    return this.state;
  }

  async deploy(config: ChannelRuntimeConfig): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'UNDEPLOYED') {
        throw new Error(`Cannot deploy: channel is ${this.state}`);
      }

      const deployed: RuntimeConnector[] = [];
      const connectors: ReadonlyArray<readonly [string, RuntimeConnector]> = [
        ['Source', config.source],
        ...[...config.destinations].map(([id, dest]) => [`Destination ${String(id)}`, dest] as const),
      ];
      for (const [name, connector] of connectors) {
        const result = await connector.onDeploy();
        if (!result.ok) {
          await Promise.all(deployed.map((c) => c.onUndeploy()));
          throw new Error(`${name} deploy failed: ${result.error.message}`);
        }
        deployed.push(connector);
      }

      config.source.setDispatcher(config.onMessage);

      this.config = config;
      this.abortController = new AbortController();
      this.state = 'STOPPED';
    });
  }

  /** A failed start stops what already started, so it leaves nothing listening. */
  async start(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STOPPED') {
        throw new Error(`Cannot start: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      const started: RuntimeConnector[] = [];
      const connectors: ReadonlyArray<readonly [string, RuntimeConnector]> = [
        ...[...this.config.destinations].map(([id, dest]) => [`Destination ${String(id)}`, dest] as const),
        ['Source', this.config.source],
      ];
      for (const [name, connector] of connectors) {
        const result = await connector.onStart();
        if (!result.ok) {
          await Promise.all(started.map((c) => c.onStop()));
          throw new Error(`${name} start failed: ${result.error.message}`);
        }
        started.push(connector);
      }

      this.runController = new AbortController();
      this.state = 'STARTED';
    });
  }

  /** Joins a stop or a halt already under way. A halt that comes while it waits takes over, and it fails. */
  async stop(): Promise<Result<void>> {
    if (this.halting) return this.halting;
    this.stopping ??= this.runStop().finally(() => { this.stopping = null; });
    return this.stopping;
  }

  private runStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STARTED' && this.state !== 'PAUSED') {
        throw new Error(`Cannot stop: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      const { haltSignal } = this;
      this.runController?.abort();
      const failures: string[] = [];

      // Stop source first (no new messages)
      const srcResult = await this.config.source.onStop();
      if (!srcResult.ok) failures.push(`Source stop failed: ${srcResult.error.message}`);

      for (const [id, dest] of this.config.destinations) {
        // The halt has it, and a start may have come since.
        if (haltSignal.aborted) break;
        const result = await dest.onStop();
        if (!result.ok) failures.push(`Destination ${String(id)} stop failed: ${result.error.message}`);
      }

      if (haltSignal.aborted) {
        await this.halting;
        throw new Error('Cannot stop: the channel was halted');
      }
      this.state = 'STOPPED';
      if (failures[0] !== undefined) throw new Error(failures[0]);
    });
  }

  /**
   * Aborted when the channel begins to stop or is halted, and while it is not running.
   * Work that is not a message coming in (crash recovery) takes nothing new after that.
   * A new signal is issued at each start; read this once per run.
   */
  get runSignal(): AbortSignal {
    return this.runController?.signal ?? AbortSignal.abort();
  }

  /**
   * Aborted when the channel is halted. Work started for a message (scripts,
   * sends) takes this signal, so a halt cancels it instead of waiting for it.
   * A new signal is issued after each halt; read this once per message.
   */
  get haltSignal(): AbortSignal {
    this.abortController ??= new AbortController();
    return this.abortController.signal;
  }

  /** Joins a halt already under way. */
  async halt(): Promise<Result<void>> {
    this.halting ??= this.runHalt().finally(() => { this.halting = null; });
    return this.halting;
  }

  private runHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STARTED' && this.state !== 'PAUSED') {
        throw new Error(`Cannot halt: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      this.abortController?.abort();
      this.abortController = new AbortController();
      this.runController?.abort();

      await this.config.source.onHalt();

      for (const [, dest] of this.config.destinations) {
        await dest.onHalt();
      }

      this.state = 'STOPPED';
    });
  }

  async pause(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STARTED') {
        throw new Error(`Cannot pause: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      const { runSignal } = this;
      await this.config.source.onStop();
      if (runSignal.aborted) throw new Error('Cannot pause: the channel is stopping');

      this.state = 'PAUSED';
    });
  }

  async resume(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'PAUSED') {
        throw new Error(`Cannot resume: channel is ${this.state}`);
      }
      const { config, runSignal } = this;
      if (!config) throw new Error('Channel not deployed');
      if (runSignal.aborted) throw new Error('Cannot resume: the channel is stopping');

      const result = await config.source.onStart();
      if (runSignal.aborted) {
        // The stop reached the source before it had started. After another start it is that one's.
        if (this.getState() !== 'STARTED') await config.source.onStop();
        throw new Error('Cannot resume: the channel is stopping');
      }
      if (!result.ok) throw new Error('Source resume failed');

      this.state = 'STARTED';
    });
  }

  async undeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STOPPED') {
        throw new Error(`Cannot undeploy: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      await this.config.source.onUndeploy();

      for (const [, dest] of this.config.destinations) {
        await dest.onUndeploy();
      }

      this.config = null;
      this.abortController = null;
      this.state = 'UNDEPLOYED';
    });
  }
}
