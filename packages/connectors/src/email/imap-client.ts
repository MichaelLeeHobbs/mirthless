import { createRequire } from 'node:module';
import { createConnectorLogger, errorInfo } from '../logger.js';

// ESM has no bare `require` at runtime (vitest injects one, which hid this).
const require = createRequire(import.meta.url);

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

export interface EmailMessage {
  readonly uid: number;
  /** Of the folder: under another one, the same UID is another email. */
  readonly uidValidity: string;
  readonly subject: string;
  readonly from: string;
  readonly to: string;
  readonly date: string;
  readonly source: Buffer;
  readonly attachmentCount: number;
  /** True when the email already carries {@link DISPATCHED_KEYWORD} or one of {@link LEGACY_DISPATCHED_KEYWORDS}. */
  readonly dispatched: boolean;
  /** True when the email carries {@link ERROR_KEYWORD}. */
  readonly held: boolean;
}

/** The server answered that it does not do it. Any other error leaves open what it did, and the connection in doubt. */
export class ImapRefusal extends Error {}

export interface ImapClient {
  connect(): Promise<void>;
  /** Only emails the server answered whole. */
  fetchUnread(folder: string): Promise<readonly EmailMessage[]>;
  markRead(uid: number): Promise<void>;
  /** Resolves false when the mailbox does not accept custom keywords. */
  mark(uid: number, keyword: string): Promise<boolean>;
  moveMessage(uid: number, folder: string): Promise<void>;
  /** This email only, whatever else in the folder is flagged deleted. */
  deleteMessage(uid: number): Promise<void>;
  disconnect(): Promise<void>;
  /** Closes the connection without a word to the server. */
  destroy(): void;
}

export interface ImapConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
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

export interface ImapFlowFetchMessage {
  readonly uid?: number;
  readonly source?: Buffer;
  readonly envelope?: ImapFlowEnvelope;
  readonly flags?: ReadonlySet<string>;
}

interface ByUid {
  readonly uid: true;
}

interface ImapFlowMailbox {
  readonly uidValidity?: bigint;
  /** What the mailbox keeps; every keyword when `\\*` is one of them, or when the server does not say. */
  readonly permanentFlags?: ReadonlySet<string>;
}

export interface ImapFlowInstance {
  connect(): Promise<void>;
  on(event: string, listener: (arg: unknown) => void): void;
  getMailboxLock(folder: string): Promise<{ release(): void }>;
  fetch(query: Record<string, unknown>, options: Record<string, unknown>): AsyncIterable<ImapFlowFetchMessage>;
  messageFlagsAdd(range: string, flags: readonly string[], options: ByUid): Promise<boolean>;
  messageMove(range: string, destination: string, options: ByUid): Promise<unknown>;
  messageDelete(range: string, options: ByUid): Promise<boolean | undefined>;
  readonly capabilities: ReadonlyMap<string, unknown>;
  readonly mailbox: ImapFlowMailbox | false;
  logout(): Promise<void>;
  close(): void;
}

const BY_UID: ByUid = { uid: true };

/** imapflow reports a failed move, deletion or flag change by resolving false, not by throwing. */
function requireDone(done: unknown, action: string, uid: number): void {
  if (!done) throw new ImapRefusal(`IMAP server refused to ${action} for UID ${String(uid)}`);
}

/**
 * Without UIDPLUS imapflow sends a plain EXPUNGE, which removes every email in the folder that
 * is flagged deleted, whoever flagged it.
 */
function requireUidExpunge(client: ImapFlowInstance, instead: string): void {
  if (client.capabilities.has('UIDPLUS')) return;
  throw new ImapRefusal(`The IMAP server cannot remove one email by itself (it does not offer UIDPLUS); use ${instead}`);
}

function keepsKeyword({ mailbox }: ImapFlowInstance, keyword: string): boolean {
  const kept = mailbox === false ? undefined : mailbox.permanentFlags;
  return kept === undefined || kept.has('\\*') || kept.has(keyword);
}

/**
 * Null for a row that is not an email we asked for: the server may add one at any time, for
 * any email, that says only that its flags changed.
 */
function toEmail(row: ImapFlowFetchMessage, uidValidity: string): EmailMessage | null {
  const { uid, source, envelope, flags } = row;
  if (uid === undefined || !Number.isSafeInteger(uid) || uid < 1) return null;
  if (source === undefined || source.length === 0 || envelope === undefined || flags === undefined) return null;
  return {
    uid,
    uidValidity,
    subject: envelope.subject ?? '',
    from: envelope.from?.[0]?.address ?? '',
    to: envelope.to?.[0]?.address ?? '',
    date: envelope.date?.toISOString() ?? '',
    source,
    attachmentCount: 0,
    dispatched: hasDispatchedKeyword(flags),
    held: hasErrorKeyword(flags),
  };
}

async function fetchUnread(client: ImapFlowInstance, folder: string): Promise<readonly EmailMessage[]> {
  const lock = await client.getMailboxLock(folder);
  try {
    if (client.mailbox === false) throw new Error(`The IMAP folder "${folder}" is not open`);
    const uidValidity = String(client.mailbox.uidValidity ?? '');
    const emails = new Map<number, EmailMessage>();
    for await (const row of client.fetch({ seen: false }, { source: true, envelope: true, uid: true, flags: true })) {
      const email = toEmail(row, uidValidity);
      if (email !== null) emails.set(email.uid, email);
    }
    return [...emails.values()];
  } finally {
    lock.release();
  }
}

export function wrapImapFlow(client: ImapFlowInstance): ImapClient {
  return {
    async connect(): Promise<void> {
      await client.connect();
    },
    fetchUnread: (folder) => fetchUnread(client, folder),
    async markRead(uid: number): Promise<void> {
      requireDone(await client.messageFlagsAdd(String(uid), ['\\Seen'], BY_UID), 'mark read', uid);
    },
    async mark(uid: number, keyword: string): Promise<boolean> {
      // imapflow answers false for this too, as for a server that refuses.
      if (!keepsKeyword(client, keyword)) return false;
      requireDone(await client.messageFlagsAdd(String(uid), [keyword], BY_UID), `set ${keyword}`, uid);
      return true;
    },
    async moveMessage(uid: number, targetFolder: string): Promise<void> {
      // Without MOVE imapflow copies the email and then removes it.
      if (!client.capabilities.has('MOVE')) requireUidExpunge(client, 'MARK_READ');
      requireDone(await client.messageMove(String(uid), targetFolder, BY_UID), `move to "${targetFolder}"`, uid);
    },
    async deleteMessage(uid: number): Promise<void> {
      requireUidExpunge(client, 'MARK_READ or MOVE');
      requireDone(await client.messageDelete(String(uid), BY_UID), 'delete', uid);
    },
    async disconnect(): Promise<void> {
      await client.logout();
    },
    destroy(): void {
      client.close();
    },
  };
}

export function createImapClient(options: ImapConnectionOptions): ImapClient {
  const { ImapFlow } = require('imapflow') as { ImapFlow: new (opts: Record<string, unknown>) => ImapFlowInstance };

  const client = new ImapFlow({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.username, pass: options.password },
    logger: false,
  });

  // ImapFlow emits 'error' when the connection drops between polls; with no listener
  // Node kills the engine process. The poll loop reconnects.
  const logger = createConnectorLogger('EMAIL');
  client.on('error', (err: unknown) => {
    logger.warn(errorInfo(err), 'IMAP client error (will reconnect on next poll)');
  });
  return wrapImapFlow(client);
}
