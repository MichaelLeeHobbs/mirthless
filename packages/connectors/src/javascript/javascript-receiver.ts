import { settleUnlessAborted, tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';

export interface JavaScriptReceiverConfig {
  readonly script: string;
  readonly pollingIntervalMs: number;
}

/**
 * Callback provided by the engine to execute a user script in the sandbox.
 * Returns the script's return value.
 */
export type ScriptRunner = (script: string) => Promise<Result<unknown>>;

export class JavaScriptReceiver implements SourceConnectorRuntime {
  private readonly config: JavaScriptReceiverConfig;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private scriptRunner: ScriptRunner | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** The poll cycle in flight, of this start or of one that was halted; there is never a second. */
  private cycle: Promise<void> | null = null;
  /** Of the current start: its cycle sends no more once a halt aborts it. */
  private halted = new AbortController();
  /** What the script returned and is not sent yet, last first. Nothing else holds it, so a halt keeps it for the next start. */
  private waiting: string[] = [];

  constructor(config: JavaScriptReceiverConfig, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('JAVASCRIPT');
  }

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

      this.halted = new AbortController();
      const { signal } = this.halted;
      this.pollTimer = setInterval(() => {
        this.poll(signal);
      }, this.config.pollingIntervalMs);
      if (this.waiting.length > 0) this.poll(signal);
    });
  }

  /** Waits for the script under way and for all it returned, however long that takes, until a halt. */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
      const { signal } = this.halted;
      // More than once when the first is of a start that was halted, whose rest the next one sends.
      while (this.cycle !== null && await settleUnlessAborted(this.cycle, signal));
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
      this.halted.abort();
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
      this.scriptRunner = null;
      this.reportWaiting();
    });
  }

  private poll(halted: AbortSignal): void {
    if (this.cycle !== null) return;
    this.cycle = this.pollCycle(halted).finally(() => {
      this.cycle = null;
      if (this.waiting.length > 0 && this.dispatcher && !this.halted.signal.aborted) this.poll(this.halted.signal);
      else this.reportWaiting();
    });
  }

  private async pollCycle(halted: AbortSignal): Promise<void> {
    try {
      if (this.waiting.length === 0) this.waiting = [...await this.executeScript()].reverse();
      await this.sendWaiting(halted);
    } catch (err) {
      // Log it: otherwise a broken script leaves the channel STARTED yet silently producing nothing.
      this.logger.error(errorInfo(err), 'JavaScript source poll cycle failed');
    }
  }

  private async sendWaiting(halted: AbortSignal): Promise<void> {
    const { dispatcher } = this;
    if (!dispatcher) return;
    while (!halted.aborted) {
      const content = this.waiting.pop();
      if (content === undefined) return;
      const raw: RawMessage = {
        content,
        sourceMap: { connectorType: 'JAVASCRIPT', executedAt: Date.now() },
      };
      const dispatched = await tryCatch(() => dispatcher(raw));
      const failure = dispatched.ok ? dispatchFailure(dispatched.value) : dispatched.error;
      if (failure !== null) this.logger.error(errorInfo(failure), 'JavaScript source message dispatch failed; it is not sent again');
    }
  }

  private reportWaiting(): void {
    if (this.waiting.length === 0) return;
    if (this.dispatcher) {
      this.logger.warn({ kept: this.waiting.length }, 'A halt kept messages that the JavaScript source script returned; the next start sends them');
      return;
    }
    this.logger.error(
      { lost: this.waiting.length },
      'Messages that the JavaScript source script returned are lost: the channel was halted before they were sent, and then undeployed',
    );
    this.waiting = [];
  }

  private async executeScript(): Promise<readonly string[]> {
    if (!this.scriptRunner) {
      return this.executeScriptFallback();
    }

    const result = await this.scriptRunner(this.config.script);
    if (!result.ok) {
      // The caller logs only thrown errors; unlogged, this leaves a silently dead channel.
      this.logger.error(errorInfo(result.error), 'JavaScript source script returned an error');
      return [];
    }
    const messages = normalizeScriptResult(result.value);
    const items = itemCount(result.value);
    if (items > messages.length) {
      this.logger.warn(
        { items, skipped: items - messages.length },
        'JavaScript source script returned items that hold no message; skipped (empty text, null, true or false in an array, or an object without data, which is also what a promise becomes that was not awaited)',
      );
    }
    return messages;
  }

  /** Fallback: evaluate script directly (used when no sandbox runner is set). */
  private async executeScriptFallback(): Promise<readonly string[]> {
    // Without a sandbox runner, we cannot execute user scripts safely.
    return [];
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export function normalizeScriptResult(value: unknown): readonly string[] {
  // `cond && text` leaves a boolean in an array where there is no message.
  const items = Array.isArray(value) ? value.filter((item) => typeof item !== 'boolean') : [value];
  return items.map(messageText).filter((text) => text !== '');
}

/** A single null, undefined or empty text is how a script says that it has nothing to send. */
function itemCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value === null || value === undefined || value === '' ? 0 : 1;
}

/** '' when the item holds no message. */
function messageText(item: unknown): string {
  if (item === null || item === undefined) return '';
  if (typeof item !== 'object' || isMessageObject(item)) return String(item);
  return Object.keys(item).length === 0 ? '' : JSON.stringify(item);
}

/** A result leaves the sandbox as JSON data, except a parsed message, whose text its own `toString` gives. */
function isMessageObject(item: object): boolean {
  return Object.hasOwn(item, 'toString') && typeof item.toString === 'function';
}
