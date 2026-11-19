import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { withTimeout } from '../timeout.js';
import { connectFresh, closeQuietly } from '../client-lifecycle.js';
import { createRequire } from 'node:module';

// ESM has no bare `require` at runtime (vitest injects one, which hid this).
const require = createRequire(import.meta.url);

const IMAP_OP_TIMEOUT_MS = 30_000;

/**
 * Lives on the mail server, so a restart before the post-action succeeds retries
 * only the post-action, not the dispatch.
 */
export const DISPATCHED_KEYWORD = '$GalvaniGraphDispatched';

/**
 * Keywords from earlier names (D-309, D-205): read as dispatched, never set, so an
 * email handled before a rename is not delivered again.
 */
export const LEGACY_DISPATCHED_KEYWORDS: readonly string[] = ['$GalvaniFlowDispatched', '$MirthlessDispatched'];

export function hasDispatchedKeyword(flags: ReadonlySet<string> | undefined): boolean {
  if (flags === undefined) return false;
  return flags.has(DISPATCHED_KEYWORD) || LEGACY_DISPATCHED_KEYWORDS.some((keyword) => flags.has(keyword));
}

const EMAIL_PROTOCOL = {
  IMAP: 'IMAP',
  POP3: 'POP3',
} as const;
type EmailProtocol = typeof EMAIL_PROTOCOL[keyof typeof EMAIL_PROTOCOL];

const EMAIL_POST_ACTION = {
  DELETE: 'DELETE',
  MARK_READ: 'MARK_READ',
  MOVE: 'MOVE',
} as const;
type EmailPostAction = typeof EMAIL_POST_ACTION[keyof typeof EMAIL_POST_ACTION];

export interface EmailReceiverConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly protocol: EmailProtocol;
  readonly folder: string;
  readonly pollingIntervalMs: number;
  readonly postAction: EmailPostAction;
  readonly moveToFolder: string;
  readonly subjectFilter: string;
  readonly includeAttachments: boolean;
}

export { EMAIL_PROTOCOL, EMAIL_POST_ACTION };
export type { EmailProtocol, EmailPostAction };

export interface EmailMessage {
  readonly uid: number;
  readonly subject: string;
  readonly from: string;
  readonly to: string;
  readonly date: string;
  readonly body: string;
  readonly attachmentCount: number;
  /** True when the email already carries {@link DISPATCHED_KEYWORD} or one of {@link LEGACY_DISPATCHED_KEYWORDS}. */
  readonly dispatched: boolean;
}

export interface ImapClient {
  connect(): Promise<void>;
  fetchUnread(folder: string): Promise<readonly EmailMessage[]>;
  markRead(uid: number): Promise<void>;
  /** Resolves false when the mailbox does not accept custom keywords. */
  markDispatched(uid: number): Promise<boolean>;
  moveMessage(uid: number, folder: string): Promise<void>;
  deleteMessage(uid: number): Promise<void>;
  disconnect(): Promise<void>;
}

export type ImapClientFactory = (config: EmailReceiverConfig) => ImapClient;

export class EmailReceiver implements SourceConnectorRuntime {
  private readonly config: EmailReceiverConfig;
  private readonly createClient: ImapClientFactory;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  /** Stop waits for this so the email gets its post-action. */
  private dispatchInFlight: Promise<void> | null = null;
  private client: ImapClient | null = null;
  /**
   * Dispatched UIDs whose post-action has not succeeded: later polls retry only the
   * post-action. Backs up {@link DISPATCHED_KEYWORD} for mailboxes that reject custom keywords.
   */
  private readonly awaitingPostAction = new Set<number>();
  /** UIDs the pipeline recorded with an error: no post-action and no second dispatch. */
  private readonly heldAfterError = new Set<number>();
  private warnedNoKeywords = false;

  constructor(config: EmailReceiverConfig, createClient?: ImapClientFactory, logger?: ConnectorLogger) {
    this.config = config;
    this.createClient = createClient ?? defaultImapClientFactory;
    this.logger = logger ?? createConnectorLogger('EMAIL');
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      // Only IMAP is implemented; reject POP3 rather than silently use IMAP.
      if (this.config.protocol !== EMAIL_PROTOCOL.IMAP) {
        throw new Error(`Unsupported email protocol: ${this.config.protocol}. Only IMAP is supported.`);
      }
      if (!this.config.host) throw new Error('Host is required');
      if (this.config.port < 1 || this.config.port > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
      if (!this.config.username) throw new Error('Username is required');
      if (!this.config.password) throw new Error('Password is required');
      if (!this.config.folder) throw new Error('Folder is required');
      if (this.config.pollingIntervalMs < 1000) {
        throw new Error('Polling interval must be at least 1000ms');
      }
      if (this.config.postAction === EMAIL_POST_ACTION.MOVE && !this.config.moveToFolder) {
        throw new Error('Move-to folder is required when postAction is MOVE');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      // Stored only once connected: a failed start must not leave stop to log out a dead session.
      await this.reconnect();

      this.pollTimer = setInterval(() => {
        void this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
      // Let an email being dispatched finish its post-action on the open session;
      // logging out first would leave it unread and dispatch it again after a
      // resume. A fetch in progress is not waited for: it dispatches nothing.
      if (this.dispatchInFlight !== null) await this.dispatchInFlight;
      await this.disconnectClient();
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
      await this.disconnectClient();
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
      this.client = null;
    });
  }

  private async pollCycle(): Promise<void> {
    if (this.polling || !this.dispatcher) return;
    this.polling = true;
    try {
      if (!this.client) await this.reconnect();
      if (!this.client) return;
      const messages = await withTimeout(
        this.client.fetchUnread(this.config.folder), IMAP_OP_TIMEOUT_MS, 'IMAP fetchUnread',
      );
      for (const msg of messages) {
        if (!this.matchesSubjectFilter(msg)) continue;
        // One email that throws must not stop the emails after it or drop a
        // working connection. It stays unread, so the next poll retries it.
        const processing = this.processMessage(msg);
        this.dispatchInFlight = processing.catch(() => undefined);
        try {
          await processing;
        } catch (err) {
          this.logger.error({ ...errorInfo(err), uid: msg.uid }, 'Email could not be processed; continuing with the next email');
        } finally {
          this.dispatchInFlight = null;
        }
      }
    } catch (err) {
      // Otherwise a dropped connection leaves the channel STARTED but silently idle.
      this.logger.error(errorInfo(err), 'Email poll cycle failed; will reconnect');
      await this.safeDisconnect();
      this.client = null;
    } finally {
      this.polling = false;
    }
  }

  private async reconnect(): Promise<void> {
    const client = this.createClient(this.config);
    this.client = await connectFresh(client, IMAP_OP_TIMEOUT_MS, 'IMAP connect', () => client.disconnect());
  }

  private async safeDisconnect(): Promise<void> {
    const client = this.client;
    if (!client) return;
    await closeQuietly({
      close: () => client.disconnect(),
      timeoutMs: IMAP_OP_TIMEOUT_MS,
      label: 'IMAP disconnect',
      logger: this.logger,
      message: 'Error disconnecting IMAP client during reconnect',
    });
  }

  private matchesSubjectFilter(msg: EmailMessage): boolean {
    if (!this.config.subjectFilter) return true;
    return msg.subject.toLowerCase().includes(this.config.subjectFilter.toLowerCase());
  }

  private async processMessage(msg: EmailMessage): Promise<void> {
    if (!this.dispatcher || !this.client) return;

    if (this.heldAfterError.has(msg.uid)) return;

    if (!msg.dispatched && !this.awaitingPostAction.has(msg.uid)) {
      const raw: RawMessage = {
        content: msg.body,
        sourceMap: {
          subject: msg.subject,
          from: msg.from,
          to: msg.to,
          date: msg.date,
          attachmentCount: msg.attachmentCount,
        },
      };

      const result = await this.dispatcher(raw);
      if (!result.ok) {
        // Left unread on the server, so the next poll retries it.
        this.logger.error({ ...errorInfo(result.error), uid: msg.uid }, 'Email dispatch failed; message left unread for retry');
        return;
      }
      const failure = dispatchFailure(result);
      if (failure !== null) {
        // Recorded with an error: no post-action (it would report success) and no
        // second dispatch while this channel stays deployed.
        this.heldAfterError.add(msg.uid);
        this.logger.error(
          { ...errorInfo(failure), uid: msg.uid },
          'Pipeline recorded an error for this email; it is left untouched in the mailbox and not read again until the channel is redeployed',
        );
        return;
      }
      this.awaitingPostAction.add(msg.uid);
      await this.recordDispatched(msg.uid);
    }

    // A post-action failure must not cause a second dispatch: the UID stays in
    // awaitingPostAction and only the post-action is retried on the next poll.
    try {
      await this.postProcess(msg.uid);
      this.awaitingPostAction.delete(msg.uid);
    } catch (err) {
      this.logger.error({ ...errorInfo(err), uid: msg.uid }, 'Email post-action failed after dispatch; will retry the post-action only');
    }
  }

  /** A failure is logged, not fatal: the in-memory set still prevents a duplicate until restart. */
  private async recordDispatched(uid: number): Promise<void> {
    const client = this.client;
    try {
      if (!client) throw new Error('IMAP client is not connected (channel stopped or halted)');
      const stored = await withTimeout(client.markDispatched(uid), IMAP_OP_TIMEOUT_MS, 'IMAP markDispatched');
      if (!stored && !this.warnedNoKeywords) {
        this.warnedNoKeywords = true;
        this.logger.warn(
          { uid, folder: this.config.folder, keyword: DISPATCHED_KEYWORD },
          'Mailbox does not accept custom IMAP keywords; an email whose post-action fails may be dispatched again after a restart',
        );
      }
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), uid },
        'Could not mark email as dispatched; if its post-action also fails, a restart may dispatch it again',
      );
    }
  }

  private async postProcess(uid: number): Promise<void> {
    // Throw rather than return: the caller would take a silent return as done and
    // stop tracking an email that is still unread, which a later poll then dispatches again.
    if (!this.client) throw new Error('IMAP client is not connected (channel stopped or halted)');

    switch (this.config.postAction) {
      case EMAIL_POST_ACTION.DELETE:
        await withTimeout(this.client.deleteMessage(uid), IMAP_OP_TIMEOUT_MS, 'IMAP deleteMessage');
        break;
      case EMAIL_POST_ACTION.MARK_READ:
        await withTimeout(this.client.markRead(uid), IMAP_OP_TIMEOUT_MS, 'IMAP markRead');
        break;
      case EMAIL_POST_ACTION.MOVE:
        await withTimeout(this.client.moveMessage(uid, this.config.moveToFolder), IMAP_OP_TIMEOUT_MS, 'IMAP moveMessage');
        break;
    }
  }

  private async disconnectClient(): Promise<void> {
    const client = this.client;
    if (!client) return;
    // Drop it first: a later stop or a failed restart must not log this session out again.
    this.client = null;
    await withTimeout(client.disconnect(), IMAP_OP_TIMEOUT_MS, 'IMAP disconnect');
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

function defaultImapClientFactory(config: EmailReceiverConfig): ImapClient {
  const { ImapFlow } = require('imapflow') as { ImapFlow: new (opts: Record<string, unknown>) => ImapFlowInstance };

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    logger: false,
  });

  // ImapFlow emits 'error' when the connection drops between polls; with no listener
  // Node kills the engine process. The poll loop reconnects.
  const factoryLogger = createConnectorLogger('EMAIL');
  client.on('error', (err: unknown) => {
    factoryLogger.warn(errorInfo(err), 'IMAP client error (will reconnect on next poll)');
  });

  return {
    async connect(): Promise<void> {
      await client.connect();
    },
    async fetchUnread(folder: string): Promise<readonly EmailMessage[]> {
      const lock = await client.getMailboxLock(folder);
      try {
        const messages: EmailMessage[] = [];
        const fetchOptions = { source: true, envelope: true, uid: true, flags: true };
        for await (const msg of client.fetch({ seen: false }, fetchOptions)) {
          messages.push({
            uid: msg.uid,
            subject: msg.envelope?.subject ?? '',
            from: msg.envelope?.from?.[0]?.address ?? '',
            to: msg.envelope?.to?.[0]?.address ?? '',
            date: msg.envelope?.date?.toISOString() ?? '',
            body: msg.source?.toString() ?? '',
            attachmentCount: 0,
            dispatched: hasDispatchedKeyword(msg.flags),
          });
        }
        return messages;
      } finally {
        lock.release();
      }
    },
    async markRead(uid: number): Promise<void> {
      requireDone(await client.messageFlagsAdd({ uid }, ['\\Seen']), 'mark read', uid);
    },
    async markDispatched(uid: number): Promise<boolean> {
      // imapflow drops a keyword the selected mailbox's PERMANENTFLAGS rejects and returns false.
      return client.messageFlagsAdd({ uid }, [DISPATCHED_KEYWORD]);
    },
    async moveMessage(uid: number, targetFolder: string): Promise<void> {
      requireDone(await client.messageMove({ uid }, targetFolder), `move to "${targetFolder}"`, uid);
    },
    async deleteMessage(uid: number): Promise<void> {
      requireDone(await client.messageFlagsAdd({ uid }, ['\\Deleted']), 'flag deleted', uid);
      await client.expunge({ uid });
    },
    async disconnect(): Promise<void> {
      await client.logout();
    },
  };
}

/**
 * imapflow reports a failed move or flag change by resolving false, not by
 * throwing. Throw so the receiver treats the post-action as failed.
 */
function requireDone(done: boolean, action: string, uid: number): void {
  if (!done) throw new Error(`IMAP server refused to ${action} for UID ${uid}`);
}

interface ImapFlowEnvelopeAddress {
  readonly address?: string;
}

interface ImapFlowEnvelope {
  readonly subject?: string;
  readonly from?: readonly ImapFlowEnvelopeAddress[];
  readonly to?: readonly ImapFlowEnvelopeAddress[];
  readonly date?: Date;
}

interface ImapFlowFetchMessage {
  readonly uid: number;
  readonly source?: Buffer;
  readonly envelope?: ImapFlowEnvelope;
  readonly flags?: ReadonlySet<string>;
}

interface ImapFlowLock {
  release(): void;
}

interface ImapFlowInstance {
  connect(): Promise<void>;
  on(event: string, listener: (arg: unknown) => void): void;
  getMailboxLock(folder: string): Promise<ImapFlowLock>;
  fetch(query: Record<string, unknown>, options: Record<string, unknown>): AsyncIterable<ImapFlowFetchMessage>;
  messageFlagsAdd(query: Record<string, unknown>, flags: readonly string[]): Promise<boolean>;
  messageMove(query: Record<string, unknown>, destination: string): Promise<boolean>;
  expunge(query: Record<string, unknown>): Promise<void>;
  logout(): Promise<void>;
}
