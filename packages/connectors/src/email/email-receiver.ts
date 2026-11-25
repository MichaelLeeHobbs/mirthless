import { settleUnlessAborted, tryCatch, type Result } from '@galvanigraph/core-util';
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

/** On an email the pipeline recorded with an error: it is left alone until someone removes the keyword. */
export const ERROR_KEYWORD = '$GalvaniGraphError';

/** IMAP keywords are the same in any case, and a server may answer with another than was set. */
function hasKeyword(flags: ReadonlySet<string> | undefined, keywords: readonly string[]): boolean {
  const names = new Set(keywords.map((keyword) => keyword.toLowerCase()));
  return [...flags ?? []].some((flag) => names.has(flag.toLowerCase()));
}

export function hasDispatchedKeyword(flags: ReadonlySet<string> | undefined): boolean {
  return hasKeyword(flags, [DISPATCHED_KEYWORD, ...LEGACY_DISPATCHED_KEYWORDS]);
}

export function hasErrorKeyword(flags: ReadonlySet<string> | undefined): boolean {
  return hasKeyword(flags, [ERROR_KEYWORD]);
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
}

export { EMAIL_PROTOCOL, EMAIL_POST_ACTION };
export type { EmailProtocol, EmailPostAction };

export interface EmailMessage {
  readonly uid: number;
  /** Of the folder: under another one, the same UID is another email. */
  readonly uidValidity: string;
  readonly subject: string;
  readonly from: string;
  readonly to: string;
  readonly date: string;
  readonly body: string;
  readonly attachmentCount: number;
  /** True when the email already carries {@link DISPATCHED_KEYWORD} or one of {@link LEGACY_DISPATCHED_KEYWORDS}. */
  readonly dispatched: boolean;
  /** True when the email carries {@link ERROR_KEYWORD}. */
  readonly held: boolean;
}

export interface ImapClient {
  connect(): Promise<void>;
  fetchUnread(folder: string): Promise<readonly EmailMessage[]>;
  markRead(uid: number): Promise<void>;
  /** Resolves false when the mailbox does not accept custom keywords. */
  mark(uid: number, keyword: string): Promise<boolean>;
  moveMessage(uid: number, folder: string): Promise<void>;
  deleteMessage(uid: number): Promise<void>;
  disconnect(): Promise<void>;
  /** Closes the connection without a word to the server. */
  destroy(): void;
}

export type ImapClientFactory = (config: EmailReceiverConfig) => ImapClient;

/** One start of the source and its connection. A cycle that outlives a halt keeps its own, not a later start's. */
interface Session {
  client: ImapClient | null;
  /** False once stop or halt is asked for: the cycle in flight takes no more emails. */
  live: boolean;
  /** An email is being dispatched, marked or post-processed. */
  inHand: boolean;
}

export class EmailReceiver implements SourceConnectorRuntime {
  private readonly config: EmailReceiverConfig;
  private readonly createClient: ImapClientFactory;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private session: Session | null = null;
  /** Of the latest start: a halt aborts it, which ends what a stop waits for. */
  private halted = new AbortController();
  /** A poll cycle is in flight, of this session or of one that was halted; there is never a second. */
  private polling = false;
  private emailInHand: Promise<void> | null = null;
  /**
   * Dispatched emails whose post-action has not succeeded: later polls retry only the
   * post-action. Backs up {@link DISPATCHED_KEYWORD} for mailboxes that reject custom keywords.
   */
  private readonly awaitingPostAction = new Set<string>();
  /** Emails the pipeline recorded with an error. Backs up {@link ERROR_KEYWORD} in the same way. */
  private readonly heldAfterError = new Set<string>();
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

      const session: Session = { client: null, live: true, inHand: false };
      await this.connect(session);
      this.session = session;
      this.halted = new AbortController();

      this.pollTimer = setInterval(() => {
        void this.pollCycle(session);
      }, this.config.pollingIntervalMs);
    });
  }

  /** Waits for the email in hand, so it is marked and post-processed before its connection goes. */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      const session = this.endSession();
      // Not only this session's: after a pause the session is gone, and its email may be in hand.
      if (this.emailInHand !== null) await settleUnlessAborted(this.emailInHand, this.halted.signal);
      if (session !== null) await this.disconnect(session);
    });
  }

  /** Does not wait: the cycle keeps the connection for an email in hand, and closes it. */
  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      const session = this.endSession();
      this.halted.abort();
      if (session === null || session.inHand) return;
      session.client?.destroy();
      session.client = null;
    });
  }

  private endSession(): Session | null {
    const { session } = this;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (session !== null) session.live = false;
    this.session = null;
    return session;
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  private async pollCycle(session: Session): Promise<void> {
    if (this.polling || !this.dispatcher) return;
    this.polling = true;
    try {
      await this.takeEmails(session);
    } catch (err) {
      // Otherwise a dropped connection leaves the channel STARTED but silently idle.
      if (session.live) this.logger.error(errorInfo(err), 'Email poll cycle failed; will reconnect');
      await this.disconnect(session);
    } finally {
      this.polling = false;
      if (!session.live) await this.disconnect(session);
    }
  }

  private async takeEmails(session: Session): Promise<void> {
    const client = session.client ?? await this.connect(session);
    const emails = await withTimeout(client.fetchUnread(this.config.folder), IMAP_OP_TIMEOUT_MS, 'IMAP fetchUnread');
    for (const email of emails) {
      if (!session.live) return;
      if (!this.matchesSubjectFilter(email)) continue;
      session.inHand = true;
      // One email that throws must not stop the emails after it or drop a
      // working connection. It stays unread, so the next poll retries it.
      this.emailInHand = this.processEmail(client, email).catch((err: unknown) => {
        this.logger.error({ ...errorInfo(err), uid: email.uid }, 'Email could not be processed; continuing with the next email');
      });
      await this.emailInHand;
      this.emailInHand = null;
      session.inHand = false;
    }
  }

  private async connect(session: Session): Promise<ImapClient> {
    const client = this.createClient(this.config);
    session.client = await connectFresh(client, IMAP_OP_TIMEOUT_MS, 'IMAP connect', () => client.disconnect());
    return session.client;
  }

  private async disconnect(session: Session): Promise<void> {
    const { client } = session;
    if (!client) return;
    // Drop it first: a later stop must not log this session out again.
    session.client = null;
    await closeQuietly({
      close: () => client.disconnect(),
      timeoutMs: IMAP_OP_TIMEOUT_MS,
      label: 'IMAP disconnect',
      logger: this.logger,
      message: 'Error disconnecting IMAP client',
    });
  }

  private matchesSubjectFilter(msg: EmailMessage): boolean {
    if (!this.config.subjectFilter) return true;
    return msg.subject.toLowerCase().includes(this.config.subjectFilter.toLowerCase());
  }

  private async processEmail(client: ImapClient, email: EmailMessage): Promise<void> {
    const key = `${email.uidValidity}:${String(email.uid)}`;
    if (email.held || this.heldAfterError.has(key)) return;
    const dispatched = email.dispatched || this.awaitingPostAction.has(key);
    if (!dispatched && !(await this.dispatch(client, email, key))) return;

    // A post-action failure must not cause a second dispatch: the email stays in
    // awaitingPostAction and only the post-action is retried on the next poll.
    try {
      await this.postProcess(client, email.uid);
      this.awaitingPostAction.delete(key);
    } catch (err) {
      this.logger.error({ ...errorInfo(err), uid: email.uid }, 'Email post-action failed after dispatch; will retry the post-action only');
    }
  }

  /** True when the pipeline took the email without an error, so it gets its post-action. */
  private async dispatch(client: ImapClient, email: EmailMessage, key: string): Promise<boolean> {
    const { dispatcher } = this;
    if (!dispatcher) return false;
    const { uid } = email;
    const raw: RawMessage = {
      content: email.body,
      sourceMap: {
        subject: email.subject,
        from: email.from,
        to: email.to,
        date: email.date,
        attachmentCount: email.attachmentCount,
      },
    };

    const result = await dispatcher(raw);
    if (!result.ok) {
      // Left unread on the server, so the next poll retries it.
      this.logger.error({ ...errorInfo(result.error), uid }, 'Email dispatch failed; message left unread for retry');
      return false;
    }
    const failure = dispatchFailure(result);
    if (failure !== null) {
      // Recorded with an error: no post-action (it would report success) and no second dispatch.
      this.heldAfterError.add(key);
      this.logger.error(
        { ...errorInfo(failure), uid, keyword: ERROR_KEYWORD },
        'Pipeline recorded an error for this email; it is left in the mailbox, marked with a keyword, and not read again',
      );
      await this.markOnServer(client, uid, ERROR_KEYWORD);
      return false;
    }
    this.awaitingPostAction.add(key);
    await this.markOnServer(client, uid, DISPATCHED_KEYWORD);
    return true;
  }

  /** A failure is logged, not fatal: what is in memory still prevents a duplicate until a restart or a redeploy. */
  private async markOnServer(client: ImapClient, uid: number, keyword: string): Promise<void> {
    try {
      const stored = await withTimeout(client.mark(uid, keyword), IMAP_OP_TIMEOUT_MS, 'IMAP mark');
      if (!stored && !this.warnedNoKeywords) {
        this.warnedNoKeywords = true;
        this.logger.warn(
          { uid, folder: this.config.folder, keyword },
          'Mailbox does not accept custom IMAP keywords; an email that is left in it may be dispatched again after a restart or a redeploy',
        );
      }
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), uid, keyword },
        'Could not mark the email on the server; if it is left in the mailbox, a restart or a redeploy may dispatch it again',
      );
    }
  }

  private async postProcess(client: ImapClient, uid: number): Promise<void> {
    switch (this.config.postAction) {
      case EMAIL_POST_ACTION.DELETE:
        await withTimeout(client.deleteMessage(uid), IMAP_OP_TIMEOUT_MS, 'IMAP deleteMessage');
        break;
      case EMAIL_POST_ACTION.MARK_READ:
        await withTimeout(client.markRead(uid), IMAP_OP_TIMEOUT_MS, 'IMAP markRead');
        break;
      case EMAIL_POST_ACTION.MOVE:
        await withTimeout(client.moveMessage(uid, this.config.moveToFolder), IMAP_OP_TIMEOUT_MS, 'IMAP moveMessage');
        break;
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
        const uidValidity = client.mailbox === false ? '' : client.mailbox.uidValidity.toString();
        const messages: EmailMessage[] = [];
        const fetchOptions = { source: true, envelope: true, uid: true, flags: true };
        for await (const msg of client.fetch({ seen: false }, fetchOptions)) {
          messages.push({
            uid: msg.uid,
            uidValidity,
            subject: msg.envelope?.subject ?? '',
            from: msg.envelope?.from?.[0]?.address ?? '',
            to: msg.envelope?.to?.[0]?.address ?? '',
            date: msg.envelope?.date?.toISOString() ?? '',
            body: msg.source?.toString() ?? '',
            attachmentCount: 0,
            dispatched: hasDispatchedKeyword(msg.flags),
            held: hasErrorKeyword(msg.flags),
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
    async mark(uid: number, keyword: string): Promise<boolean> {
      // imapflow drops a keyword the selected mailbox's PERMANENTFLAGS rejects and returns false.
      return client.messageFlagsAdd({ uid }, [keyword]);
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
    destroy(): void {
      client.close();
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
  readonly mailbox: { readonly uidValidity: bigint } | false;
  logout(): Promise<void>;
  close(): void;
}
