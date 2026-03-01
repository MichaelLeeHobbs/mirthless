// ===========================================
// JavaScript Receiver (Source Connector)
// ===========================================
// Poll-based source that executes a user script in the
// sandbox and dispatches the returned value(s) as messages.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';

// ----- Config -----

export interface JavaScriptReceiverConfig {
  readonly script: string;
  readonly pollingIntervalMs: number;
}

// ----- Script runner callback (injected by engine) -----

/**
 * Callback provided by the engine to execute a user script in the sandbox.
 * Returns the script's return value as a string or array of strings.
 */
export type ScriptRunner = (script: string) => Promise<Result<unknown>>;

// ----- Receiver -----

export class JavaScriptReceiver implements SourceConnectorRuntime {
  private readonly config: JavaScriptReceiverConfig;
  private dispatcher: MessageDispatcher | null = null;
  private scriptRunner: ScriptRunner | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(config: JavaScriptReceiverConfig) {
    this.config = config;
  }

  /** Set the callback used to execute scripts in the sandbox. */
  setScriptRunner(runner: ScriptRunner): void {
    this.scriptRunner = runner;
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.script) {
        throw new Error('Script is required');
      }
      if (this.config.pollingIntervalMs < 100) {
        throw new Error('Polling interval must be at least 100ms');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      this.pollTimer = setInterval(() => {
        void this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
      this.scriptRunner = null;
    });
  }

  /** Execute one poll cycle: run script, dispatch returned messages. */
  private async pollCycle(): Promise<void> {
    if (this.polling || !this.dispatcher) return;
    this.polling = true;
    try {
      const messages = await this.executeScript();
      for (const content of messages) {
        const raw: RawMessage = {
          content,
          sourceMap: { connectorType: 'JAVASCRIPT', executedAt: Date.now() },
        };
        await this.dispatcher(raw);
      }
    } catch {
      // Poll cycle errors are non-fatal; next cycle will retry.
    } finally {
      this.polling = false;
    }
  }

  /** Run the user script and normalize the result to an array of strings. */
  private async executeScript(): Promise<readonly string[]> {
    if (!this.scriptRunner) {
      return this.executeScriptFallback();
    }

    const result = await this.scriptRunner(this.config.script);
    if (!result.ok) return [];
    return normalizeScriptResult(result.value);
  }

  /** Fallback: evaluate script directly (used when no sandbox runner is set). */
  private async executeScriptFallback(): Promise<readonly string[]> {
    // Without a sandbox runner, we cannot execute user scripts safely.
    return [];
  }

  /** Clear the poll interval timer. */
  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

/** Normalize a script return value to an array of strings. */
export function normalizeScriptResult(value: unknown): readonly string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.length > 0 ? [value] : [];
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return [String(value)];
}
