import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';

export interface JavaScriptDispatcherConfig {
  readonly script: string;
}

/** Supplied by the engine: runs the script in its sandbox. */
export type DestScriptRunner = (
  script: string,
  content: string,
  connectorMessage: ConnectorMessage,
) => Promise<Result<unknown>>;

export class JavaScriptDispatcher implements DestinationConnectorRuntime {
  private readonly config: JavaScriptDispatcherConfig;
  private started = false;
  private scriptRunner: DestScriptRunner | null = null;

  constructor(config: JavaScriptDispatcherConfig) {
    this.config = config;
  }

  setScriptRunner(runner: DestScriptRunner): void {
    this.scriptRunner = runner;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.script) {
        throw new Error('Script is required');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = true;
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.started) {
        throw new Error('Dispatcher not started');
      }
      if (signal.aborted) {
        throw new Error('Send aborted');
      }

      if (!this.scriptRunner) {
        throw new Error('Script runner not set — call setScriptRunner before send');
      }

      const result = await this.scriptRunner(this.config.script, message.content, message);
      if (!result.ok) {
        return {
          status: 'ERROR' as const,
          content: '',
          errorMessage: result.error.message,
        };
      }

      const responseContent = result.value !== null && result.value !== undefined
        ? String(result.value)
        : '';

      return { status: 'SENT' as const, content: responseContent };
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
      this.scriptRunner = null;
    });
  }
}
