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

      this.state = 'STARTED';
    });
  }

  async stop(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STARTED' && this.state !== 'PAUSED') {
        throw new Error(`Cannot stop: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      const failures: string[] = [];

      // Stop source first (no new messages)
      const srcResult = await this.config.source.onStop();
      if (!srcResult.ok) failures.push(`Source stop failed: ${srcResult.error.message}`);

      for (const [id, dest] of this.config.destinations) {
        const result = await dest.onStop();
        if (!result.ok) failures.push(`Destination ${String(id)} stop failed: ${result.error.message}`);
      }

      this.state = 'STOPPED';
      if (failures[0] !== undefined) throw new Error(failures[0]);
    });
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

  async halt(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STARTED' && this.state !== 'PAUSED') {
        throw new Error(`Cannot halt: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      this.abortController?.abort();
      this.abortController = new AbortController();

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

      await this.config.source.onStop();

      this.state = 'PAUSED';
    });
  }

  async resume(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'PAUSED') {
        throw new Error(`Cannot resume: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      const result = await this.config.source.onStart();
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
