// ===========================================
// Email Receiver (Source Connector)
// ===========================================
// Polls a mailbox via IMAP for unread messages,
// dispatches each as a message, then applies
// post-processing (delete, mark read, or move).

import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';

// ----- Constants -----

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

// ----- Config -----

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

// ----- IMAP Client abstraction (for testability) -----

/** A single email message fetched from the mailbox. */
export interface EmailMessage {
  readonly uid: number;
  readonly subject: string;
  readonly from: string;
  readonly to: string;
  readonly date: string;
  readonly body: string;
  readonly attachmentCount: number;
}

/** Abstraction over IMAP client for testability. */
export interface ImapClient {
  connect(): Promise<void>;
  fetchUnread(folder: string): Promise<readonly EmailMessage[]>;
  markRead(uid: number): Promise<void>;
  moveMessage(uid: number, folder: string): Promise<void>;
  deleteMessage(uid: number): Promise<void>;
  disconnect(): Promise<void>;
}

/** Factory function to create an IMAP client. Defaults to imapflow. */
export type ImapClientFactory = (config: EmailReceiverConfig) => ImapClient;

// ----- Receiver -----

export class EmailReceiver implements SourceConnectorRuntime {
  private readonly config: EmailReceiverConfig;
  private readonly createClient: ImapClientFactory;
  private dispatcher: MessageDispatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private client: ImapClient | null = null;

  constructor(config: EmailReceiverConfig, createClient?: ImapClientFactory) {
    this.config = config;
    this.createClient = createClient ?? defaultImapClientFactory;
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
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

      this.client = this.createClient(this.config);
      await this.client.connect();

      this.pollTimer = setInterval(() => {
        void this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
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

  /** Execute one poll cycle: fetch unread, filter, dispatch, post-process. */
  private async pollCycle(): Promise<void> {
    if (this.polling || !this.dispatcher || !this.client) return;
    this.polling = true;
    try {
      const messages = await this.client.fetchUnread(this.config.folder);
      for (const msg of messages) {
        if (this.matchesSubjectFilter(msg)) {
          await this.processMessage(msg);
        }
      }
    } catch {
      // Poll cycle errors are non-fatal; next cycle will retry.
    } finally {
      this.polling = false;
    }
  }

  /** Check if a message matches the subject filter (if configured). */
  private matchesSubjectFilter(msg: EmailMessage): boolean {
    if (!this.config.subjectFilter) return true;
    return msg.subject.toLowerCase().includes(this.config.subjectFilter.toLowerCase());
  }

  /** Dispatch a single email message and apply post-processing. */
  private async processMessage(msg: EmailMessage): Promise<void> {
    if (!this.dispatcher || !this.client) return;

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

    if (result.ok) {
      await this.postProcess(msg.uid);
    }
  }

  /** Apply post-processing action to a processed email. */
  private async postProcess(uid: number): Promise<void> {
    if (!this.client) return;

    switch (this.config.postAction) {
      case EMAIL_POST_ACTION.DELETE:
        await this.client.deleteMessage(uid);
        break;
      case EMAIL_POST_ACTION.MARK_READ:
        await this.client.markRead(uid);
        break;
      case EMAIL_POST_ACTION.MOVE:
        await this.client.moveMessage(uid, this.config.moveToFolder);
        break;
    }
  }

  /** Disconnect the IMAP client if connected. */
  private async disconnectClient(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
  }

  /** Clear the poll interval timer. */
  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

// ----- Default IMAP client factory (imapflow) -----

/** Create an imapflow-based IMAP client. Requires imapflow to be installed. */
function defaultImapClientFactory(config: EmailReceiverConfig): ImapClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImapFlow } = require('imapflow') as { ImapFlow: new (opts: Record<string, unknown>) => ImapFlowInstance };

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    logger: false,
  });

  return {
    async connect(): Promise<void> {
      await client.connect();
    },
    async fetchUnread(folder: string): Promise<readonly EmailMessage[]> {
      const lock = await client.getMailboxLock(folder);
      try {
        const messages: EmailMessage[] = [];
        const fetchOptions = { source: true, envelope: true, uid: true };
        for await (const msg of client.fetch({ seen: false }, fetchOptions)) {
          messages.push({
            uid: msg.uid,
            subject: msg.envelope?.subject ?? '',
            from: msg.envelope?.from?.[0]?.address ?? '',
            to: msg.envelope?.to?.[0]?.address ?? '',
            date: msg.envelope?.date?.toISOString() ?? '',
            body: msg.source?.toString() ?? '',
            attachmentCount: 0,
          });
        }
        return messages;
      } finally {
        lock.release();
      }
    },
    async markRead(uid: number): Promise<void> {
      await client.messageFlagsAdd({ uid }, ['\\Seen']);
    },
    async moveMessage(uid: number, targetFolder: string): Promise<void> {
      await client.messageMove({ uid }, targetFolder);
    },
    async deleteMessage(uid: number): Promise<void> {
      await client.messageFlagsAdd({ uid }, ['\\Deleted']);
      await client.expunge({ uid });
    },
    async disconnect(): Promise<void> {
      await client.logout();
    },
  };
}

// ----- ImapFlow type helpers (minimal interface for require) -----

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
}

interface ImapFlowLock {
  release(): void;
}

interface ImapFlowInstance {
  connect(): Promise<void>;
  getMailboxLock(folder: string): Promise<ImapFlowLock>;
  fetch(query: Record<string, unknown>, options: Record<string, unknown>): AsyncIterable<ImapFlowFetchMessage>;
  messageFlagsAdd(query: Record<string, unknown>, flags: readonly string[]): Promise<void>;
  messageMove(query: Record<string, unknown>, destination: string): Promise<void>;
  expunge(query: Record<string, unknown>): Promise<void>;
  logout(): Promise<void>;
}
