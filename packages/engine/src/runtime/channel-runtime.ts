// ===========================================
// Channel Runtime — State Machine
// ===========================================
// Manages channel lifecycle: deploy → start → stop → undeploy.
// Coordinates source connector, destination connectors, and pipeline.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { CHANNEL_STATE } from '@mirthless/core-models';

// ----- Types -----

type ChannelState = (typeof CHANNEL_STATE)[keyof typeof CHANNEL_STATE];

/** Connector lifecycle interface (matches connectors package). */
export interface RuntimeConnector {
  onDeploy(): Promise<Result<void>>;
  onStart(): Promise<Result<void>>;
  onStop(): Promise<Result<void>>;
  onHalt(): Promise<Result<void>>;
  onUndeploy(): Promise<Result<void>>;
}

/** Source connector with dispatcher. */
export interface RuntimeSourceConnector extends RuntimeConnector {
  setDispatcher(dispatcher: (raw: { content: string; sourceMap: Record<string, unknown> }) => Promise<Result<{ messageId: number; response?: string }>>): void;
}

/** Channel configuration needed for runtime. */
export interface ChannelRuntimeConfig {
  readonly channelId: string;
  readonly source: RuntimeSourceConnector;
  readonly destinations: ReadonlyMap<number, RuntimeConnector>;
  readonly onMessage: (raw: { content: string; sourceMap: Record<string, unknown> }) => Promise<Result<{ messageId: number; response?: string }>>;
}

// ----- State Machine -----

export class ChannelRuntime {
  private state: ChannelState = 'UNDEPLOYED';
  private config: ChannelRuntimeConfig | null = null;
  private abortController: AbortController | null = null;

  /** Get current channel state. */
  getState(): ChannelState {
    return this.state;
  }

  /** Deploy: load config, init connectors. UNDEPLOYED → STOPPED. */
  async deploy(config: ChannelRuntimeConfig): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'UNDEPLOYED') {
        throw new Error(`Cannot deploy: channel is ${this.state}`);
      }

      this.config = config;
      this.abortController = new AbortController();

      // Deploy source
      const srcResult = await config.source.onDeploy();
      if (!srcResult.ok) throw new Error('Source deploy failed');

      // Deploy destinations
      for (const [, dest] of config.destinations) {
        const destResult = await dest.onDeploy();
        if (!destResult.ok) throw new Error('Destination deploy failed');
      }

      // Wire source dispatcher
      config.source.setDispatcher(config.onMessage);

      this.state = 'STOPPED';
    });
  }

  /** Start: start destinations first, then source. STOPPED → STARTED. */
  async start(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STOPPED') {
        throw new Error(`Cannot start: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      // Start destinations first
      for (const [, dest] of this.config.destinations) {
        const result = await dest.onStart();
        if (!result.ok) throw new Error('Destination start failed');
      }

      // Start source
      const srcResult = await this.config.source.onStart();
      if (!srcResult.ok) throw new Error('Source start failed');

      this.state = 'STARTED';
    });
  }

  /** Stop: stop source first, then destinations. STARTED → STOPPED. */
  async stop(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STARTED' && this.state !== 'PAUSED') {
        throw new Error(`Cannot stop: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      // Stop source first (no new messages)
      await this.config.source.onStop();

      // Stop destinations
      for (const [, dest] of this.config.destinations) {
        await dest.onStop();
      }

      this.state = 'STOPPED';
    });
  }

  /** Halt: force-stop via AbortController. STARTED|PAUSED → STOPPED. */
  async halt(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.state !== 'STARTED' && this.state !== 'PAUSED') {
        throw new Error(`Cannot halt: channel is ${this.state}`);
      }
      if (!this.config) throw new Error('Channel not deployed');

      // Signal abort to all in-flight operations
      this.abortController?.abort();
      this.abortController = new AbortController();

      // Force-halt source
      await this.config.source.onHalt();

      // Force-halt destinations
      for (const [, dest] of this.config.destinations) {
        await dest.onHalt();
      }

      this.state = 'STOPPED';
    });
  }

  /** Pause: stop source only, destinations keep running. STARTED → PAUSED. */
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

  /** Resume: restart source. PAUSED → STARTED. */
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

  /** Undeploy: clean up all connectors. STOPPED → UNDEPLOYED. */
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
