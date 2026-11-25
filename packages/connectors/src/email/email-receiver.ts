import { settleUnlessAborted, stderr, tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, SourceHealthHandler, MessageDispatcher, RawMessage, DispatchResult } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { withTimeout } from '../timeout.js';
import { connectFresh, closeQuietly } from '../client-lifecycle.js';
import {
  createImapClient,
  DISPATCHED_KEYWORD,
  ERROR_KEYWORD,
  ImapRefusal,
  type EmailMessage,
  type ImapClient,
  type ImapConnectionOptions,
  type UnreadEmails,
} from './imap-client.js';

const IMAP_OP_TIMEOUT_MS = 30_000;

/** How many UIDs one log line names. */
const REPORTED_UIDS = 20;

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

export interface EmailReceiverConfig extends ImapConnectionOptions {
  readonly protocol: EmailProtocol;
  readonly folder: string;
  readonly pollingIntervalMs: number;
  readonly postAction: EmailPostAction;
  readonly moveToFolder: string;
  readonly subjectFilter: string;
}

export { EMAIL_PROTOCOL, EMAIL_POST_ACTION };
export type { EmailProtocol, EmailPostAction };

export type ImapClientFactory = (options: ImapConnectionOptions) => ImapClient;

/** One start of the source and its connection. A cycle that outlives a halt keeps its own, not a later start's. */
interface Session {
  client: ImapClient | null;
  /** False once stop or halt is asked for: the cycle in flight takes no more emails. */
  live: boolean;
  /** An email is being dispatched, marked or post-processed. */
  inHand: boolean;
  /** Ends once the connection dropped last is closed. */
  closed: Promise<void>;
}

interface ListedEmail {
  readonly key: string;
  readonly email: EmailMessage;
  /** Dispatched before, by this source or another, or recorded with an error. */
  readonly known: boolean;
}

export class EmailReceiver implements SourceConnectorRuntime {
  private readonly config: EmailReceiverConfig;
  private readonly createClient: ImapClientFactory;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private health: SourceHealthHandler = () => undefined;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private session: Session | null = null;
  /** Of the latest start: a halt aborts it, which ends what a stop waits for. */
  private halted = new AbortController();
  /** A poll cycle is in flight, of this session or of one that was halted; there is never a second. */
  private polling = false;
  private emailInHand: Promise<void> | null = null;
  /**
   * Emails this instance dispatched, and whether their post-action went through: later polls run
   * only that. Backs up {@link DISPATCHED_KEYWORD} for mailboxes that reject custom keywords, and
   * is what `DELETE` goes by: the keyword does not say which channel recorded the email.
   */
  private readonly recorded = new Map<string, { done: boolean }>();
  /** Emails the pipeline recorded with an error. Backs up {@link ERROR_KEYWORD} in the same way. */
  private readonly heldAfterError = new Set<string>();
  /** Emails already reported as left in the folder: not deleted, or not dispatched. */
  private readonly reported = new Set<string>();
  private readonly reportedUnreadable = new Set<string>();
  private warnedNoKeywords = false;

  constructor(config: EmailReceiverConfig, createClient?: ImapClientFactory, logger?: ConnectorLogger) {
    this.config = config;
    this.createClient = createClient ?? createImapClient;
    this.logger = logger ?? createConnectorLogger('EMAIL');
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  setHealthHandler(handler: SourceHealthHandler): void {
    this.health = handler;
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

      const session: Session = { client: null, live: true, inHand: false, closed: Promise.resolve() };
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
      const { signal } = this.halted;
      const session = this.endSession();
      // Not only this session's: after a pause the session is gone, and its email may be in hand.
      if (this.emailInHand !== null) await settleUnlessAborted(this.emailInHand, signal);
      if (session === null) return;
      if (signal.aborted) destroyIdle(session);
      else await settleUnlessAborted(this.disconnect(session), signal);
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      const session = this.endSession();
      this.halted.abort();
      if (session !== null) destroyIdle(session);
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
      if (session.live) {
        this.logger.error(errorInfo(err), 'Email poll cycle failed; will reconnect');
        this.health(stderr(err));
      }
      await this.disconnect(session);
    } finally {
      this.polling = false;
      if (!session.live) await this.disconnect(session);
    }
  }

  private async takeEmails(session: Session): Promise<void> {
    const { client, unread } = await this.list(session);
    if (!session.live) return;
    this.health(null);
    this.forgetGone(unread);
    const listed = unread.emails.filter((email) => this.matchesSubjectFilter(email)).map((email) => this.known(unread, email));
    this.report(unread, listed);
    // New ones first: one whose mark or post-action always fails ends the poll.
    for (const item of [...listed.filter(({ known }) => !known), ...listed.filter(({ known }) => known)]) {
      if (!session.live) return;
      session.inHand = true;
      const processing = this.processEmail(client, item);
      this.emailInHand = processing.then(() => undefined, () => undefined);
      try {
        await processing;
      } finally {
        this.emailInHand = null;
        session.inHand = false;
      }
    }
  }

  /** A server may close a connection that is kept from poll to poll, so one that fails is replaced at once. */
  private async list(session: Session): Promise<{ readonly client: ImapClient; readonly unread: UnreadEmails }> {
    const kept = session.client;
    if (kept !== null) {
      const listed = await tryCatch(() => this.unreadOf(kept));
      if (listed.ok) return { client: kept, unread: listed.value };
      if (!session.live) throw listed.error;
      this.logger.warn(errorInfo(listed.error), 'Email folder could not be read on the connection kept from the last poll; trying a new one');
      await this.disconnect(session);
    }
    const client = await this.connect(session);
    if (!session.live) throw new Error('The source was stopped while it connected');
    return { client, unread: await this.unreadOf(client) };
  }

  private unreadOf(client: ImapClient): Promise<UnreadEmails> {
    return withTimeout(client.fetchUnread(this.config.folder), IMAP_OP_TIMEOUT_MS, 'IMAP fetchUnread');
  }

  private known({ uidValidity }: UnreadEmails, email: EmailMessage): ListedEmail {
    const key = keyOf(uidValidity, email.uid);
    return { key, email, known: email.held || email.dispatched || this.recorded.has(key) || this.heldAfterError.has(key) };
  }

  /** A listing can lack an email that is still there, so only one that was dealt with is forgotten when it is gone. */
  private forgetGone({ uidValidity, emails, unreadable }: UnreadEmails): void {
    const listed = new Set([...emails.map(({ uid }) => uid), ...unreadable].map((uid) => keyOf(uidValidity, uid)));
    const otherFolder = (key: string): boolean => !key.startsWith(keyOf(uidValidity, ''));
    for (const [key, { done }] of this.recorded) {
      if (otherFolder(key) || (done && !listed.has(key))) this.recorded.delete(key);
    }
    for (const keys of [this.heldAfterError, this.reported, this.reportedUnreadable]) {
      for (const key of keys) {
        if (otherFolder(key)) keys.delete(key);
      }
    }
  }

  private async connect(session: Session): Promise<ImapClient> {
    // Without UIDVALIDITY a UID means nothing on another connection.
    for (const keys of [this.recorded, this.heldAfterError]) {
      for (const key of keys.keys()) {
        if (key.startsWith(keyOf('', ''))) keys.delete(key);
      }
    }
    const client = this.createClient(this.config);
    session.client = await connectFresh(client, IMAP_OP_TIMEOUT_MS, 'IMAP connect', () => client.disconnect());
    return session.client;
  }

  private disconnect(session: Session): Promise<void> {
    const { client } = session;
    if (client) {
      // Drop it first: a later stop must not log this session out again.
      session.client = null;
      session.closed = closeQuietly({
        close: () => client.disconnect(),
        timeoutMs: IMAP_OP_TIMEOUT_MS,
        label: 'IMAP disconnect',
        logger: this.logger,
        message: 'Error disconnecting IMAP client',
      });
    }
    return session.closed;
  }

  private matchesSubjectFilter(msg: EmailMessage): boolean {
    if (!this.config.subjectFilter) return true;
    return msg.subject.toLowerCase().includes(this.config.subjectFilter.toLowerCase());
  }

  /** Rejects when the connection is in doubt, so no further email is dispatched that it could not mark. */
  private async processEmail(client: ImapClient, { key, email }: ListedEmail): Promise<void> {
    if (email.held) {
      // What the server shows counts from here on: without the keyword, the email is dispatched again.
      if (this.heldAfterError.delete(key)) this.reported.add(key);
      return;
    }
    if (this.heldAfterError.has(key)) {
      await this.markOnServer(client, email.uid, ERROR_KEYWORD);
      return;
    }
    if (this.isLeft(key, email)) return;
    const before = email.dispatched || this.recorded.has(key);
    if (!before && !(await this.dispatch(client, email, key))) return;
    const done = await this.postProcessed(client, email, key);
    // After the post-action, or a mark that always fails would keep it from being tried.
    if (!done && before && !email.dispatched) await this.markOnServer(client, email.uid, DISPATCHED_KEYWORD);
  }

  /** False when the server refused it. */
  private async postProcessed(client: ImapClient, email: EmailMessage, key: string): Promise<boolean> {
    try {
      await this.postProcess(client, email);
      const entry = this.recorded.get(key);
      if (entry) entry.done = true;
      return true;
    } catch (err) {
      // Still in `recorded`, so the next poll retries only the post-action.
      this.logger.error({ ...errorInfo(err), uid: email.uid }, 'Email post-action failed after dispatch; will retry the post-action only');
      if (!(err instanceof ImapRefusal)) throw err;
      return false;
    }
  }

  /** Its keyword is from before this channel was deployed, or another channel's: `DELETE` goes only by what this instance recorded. */
  private isLeft(key: string, email: EmailMessage): boolean {
    return this.config.postAction === EMAIL_POST_ACTION.DELETE && email.dispatched && !this.recorded.has(key);
  }

  private report(unread: UnreadEmails, listed: readonly ListedEmail[]): void {
    const keysOf = (items: readonly ListedEmail[]): string[] => items.map(({ key }) => key);
    this.reportOnce(
      this.reportedUnreadable,
      unread.unreadable.map((uid) => keyOf(unread.uidValidity, uid)),
      'Emails could not be read: the mail server listed them and did not answer with their content. They stay in the folder, unread, or are gone from it',
    );
    this.reportOnce(
      this.reported,
      keysOf(listed.filter(({ key, email }) => this.isLeft(key, email))),
      'Emails not deleted: their keyword says that they were dispatched before this channel was deployed, or by another channel. They stay in the folder; delete them there if their messages are recorded',
    );
    this.reportOnce(
      this.reported,
      keysOf(listed.filter(({ key, email }) => email.held && !this.heldAfterError.has(key))),
      `Emails not read: their keyword ${ERROR_KEYWORD} says that their messages were recorded with an error, by this channel or another. They stay in the folder until it is removed`,
    );
  }

  private reportOnce(reported: Set<string>, keys: readonly string[], message: string): void {
    const unreported = keys.filter((key) => !reported.has(key));
    if (unreported.length === 0) return;
    for (const key of unreported) reported.add(key);
    const uids = unreported.slice(0, REPORTED_UIDS).map((key) => Number(key.slice(key.lastIndexOf(':') + 1)));
    this.logger.warn({ emails: unreported.length, uids, folder: this.config.folder }, message);
  }

  /** True when the pipeline took the email without an error, so it gets its post-action. */
  private async dispatch(client: ImapClient, email: EmailMessage, key: string): Promise<boolean> {
    const { dispatcher } = this;
    if (!dispatcher) return false;
    const { uid } = email;
    const raw: RawMessage = {
      content: textOf(email),
      sourceMap: {
        subject: email.subject,
        from: email.from,
        to: email.to,
        date: email.date,
        attachmentCount: email.attachmentCount,
      },
    };

    const result = await this.dispatchRaw(dispatcher, raw);
    if (!result.ok) {
      // Left unread on the server, so the next poll retries it.
      this.logger.error({ ...errorInfo(result.error), uid }, 'Email dispatch failed; message left unread for retry');
      return false;
    }
    const failure = this.failureOf(result);
    if (failure !== null) {
      // Recorded with an error: no post-action (it would report success) and no second dispatch.
      this.heldAfterError.add(key);
      this.logger.error(
        { ...errorInfo(failure), uid, keyword: ERROR_KEYWORD },
        'Pipeline recorded an error for this email; it is left in the mailbox and not dispatched again',
      );
      await this.markOnServer(client, uid, ERROR_KEYWORD);
      return false;
    }
    this.recorded.set(key, { done: false });
    await this.markOnServer(client, uid, DISPATCHED_KEYWORD);
    return true;
  }

  /** A throw becomes a failed result: the email stays unread, and those after it are still taken. */
  private async dispatchRaw(dispatcher: MessageDispatcher, raw: RawMessage): Promise<Result<DispatchResult>> {
    const called = await tryCatch(() => dispatcher(raw));
    return called.ok ? called.value : called;
  }

  /** `DELETE` takes away what a message with a failed destination is reprocessed from, when the channel does not store it. */
  private failureOf(result: Result<DispatchResult>): Error | null {
    if (result.ok && result.value.destinationFailed === true && this.config.postAction === EMAIL_POST_ACTION.DELETE) {
      return new Error(`A destination or the postprocessor failed for message ${String(result.value.messageId)}`);
    }
    return dispatchFailure(result);
  }

  /** What is in memory still prevents a duplicate when this fails, until a restart or a redeploy. */
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
      if (!(err instanceof ImapRefusal)) throw err;
    }
  }

  private async postProcess(client: ImapClient, email: EmailMessage): Promise<void> {
    const { uid } = email;
    switch (this.config.postAction) {
      case EMAIL_POST_ACTION.DELETE:
        if (holdsAllBytes(email)) {
          await withTimeout(client.deleteMessage(uid), IMAP_OP_TIMEOUT_MS, 'IMAP deleteMessage');
        } else {
          this.logger.error({ uid, folder: this.config.folder }, 'Email marked read, not deleted: it is not valid UTF-8, so its message does not hold all of it');
          await withTimeout(client.markRead(uid), IMAP_OP_TIMEOUT_MS, 'IMAP markRead');
        }
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

/** The cycle keeps the connection for an email in hand, and closes it. */
function destroyIdle(session: Session): void {
  if (session.inHand) return;
  session.client?.destroy();
  session.client = null;
}

function keyOf(uidValidity: string, uid: number | ''): string {
  return `${uidValidity}:${String(uid)}`;
}

function textOf(email: EmailMessage): string {
  return email.source.toString('utf8');
}

function holdsAllBytes(email: EmailMessage): boolean {
  return Buffer.from(textOf(email), 'utf8').equals(email.source);
}
