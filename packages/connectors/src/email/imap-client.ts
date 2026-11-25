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

export interface UnreadEmails {
  /** Of the folder: under another one, the same UID is another email. */
  readonly uidValidity: string;
  readonly emails: readonly EmailMessage[];
  /** UIDs the server listed and did not answer whole. */
  readonly unreadable: readonly number[];
}

/** The server answered that it does not do it. Any other error leaves open what it did, and the connection in doubt. */
export class ImapRefusal extends Error {}

export interface ImapClient {
  connect(): Promise<void>;
  fetchUnread(folder: string): Promise<UnreadEmails>;
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
  /** The text of the header when imapflow cannot read it as a date. */
  readonly date?: Date | string;
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
  search(query: Record<string, unknown>, options: ByUid): Promise<unknown>;
  fetch(range: string, query: Record<string, unknown>, options: ByUid): AsyncIterable<ImapFlowFetchMessage>;
  messageFlagsAdd(range: string, flags: readonly string[], options: ByUid): Promise<boolean>;
  messageMove(range: string, destination: string, options: ByUid): Promise<unknown>;
  messageDelete(range: string, options: ByUid): Promise<boolean | undefined>;
  readonly capabilities: ReadonlyMap<string, unknown>;
  readonly mailbox: ImapFlowMailbox | false;
  /** False once the connection is gone. */
  readonly usable: boolean;
  /** Why the server is closing the connection, once it has said so. */
  readonly byeReason?: unknown;
  logout(): Promise<void>;
  close(): void;
}

const BY_UID: ByUid = { uid: true };

/** imapflow reports a failed move, deletion or flag change by resolving false, a lost connection included. */
function requireDone(client: ImapFlowInstance, done: unknown, action: string, uid: number): void {
  if (done) return;
  if (!client.usable || client.mailbox === false || client.byeReason !== undefined) {
    throw new Error(`The IMAP connection was lost; it is not known whether the server did this: ${action} for UID ${String(uid)}`);
  }
  throw new ImapRefusal(`IMAP server refused to ${action} for UID ${String(uid)}`);
}

/** Without UIDVALIDITY nothing tells whether a UID is still that of the email it was when it was read. */
function requireLastingUids({ mailbox }: ImapFlowInstance): void {
  if (mailbox === false) throw new Error('The IMAP connection has no folder open any more');
  if (mailbox.uidValidity !== undefined) return;
  throw new ImapRefusal('The IMAP server does not say whether the UIDs of the folder last (UIDVALIDITY); use MARK_READ');
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

function dateText(date: Date | string | undefined): string {
  return date instanceof Date ? date.toISOString() : date ?? '';
}

/** Null for a row without all of the email: the server may add one at any time that says only that its flags changed. */
function toEmail({ uid, source, envelope, flags }: ImapFlowFetchMessage): EmailMessage | null {
  if (uid === undefined || source === undefined || source.length === 0 || flags === undefined) return null;
  return {
    uid,
    subject: envelope?.subject ?? '',
    from: envelope?.from?.[0]?.address ?? '',
    to: envelope?.to?.[0]?.address ?? '',
    date: dateText(envelope?.date),
    source,
    attachmentCount: 0,
    dispatched: hasDispatchedKeyword(flags),
    held: hasErrorKeyword(flags),
  };
}

/** A search the server refuses answers false, which a fetch by query takes for an empty folder. */
async function searchUnread(client: ImapFlowInstance): Promise<readonly number[]> {
  const uids = await client.search({ seen: false }, BY_UID);
  if (!Array.isArray(uids)) throw new Error('The IMAP server did not answer the search for unread emails');
  return uids.filter((uid): uid is number => Number.isSafeInteger(uid) && uid > 0);
}

/** A server limits how long a command may be. */
const FETCH_CHUNK = 200;

async function fetchUnread(client: ImapFlowInstance, folder: string): Promise<UnreadEmails> {
  const lock = await client.getMailboxLock(folder);
  try {
    if (client.mailbox === false) throw new Error(`The IMAP folder "${folder}" is not open`);
    const uidValidity = String(client.mailbox.uidValidity ?? '');
    const uids = await searchUnread(client);
    const read = new Map<number, EmailMessage>();
    for (let i = 0; i < uids.length; i += FETCH_CHUNK) {
      const range = uids.slice(i, i + FETCH_CHUNK).join(',');
      for await (const row of client.fetch(range, { source: true, envelope: true, uid: true, flags: true }, BY_UID)) {
        const email = toEmail(row);
        if (email !== null) read.set(email.uid, email);
      }
    }
    return {
      uidValidity,
      emails: uids.flatMap((uid) => read.get(uid) ?? []),
      unreadable: uids.filter((uid) => !read.has(uid)),
    };
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
      requireDone(client, await client.messageFlagsAdd(String(uid), ['\\Seen'], BY_UID), 'mark read', uid);
    },
    async mark(uid: number, keyword: string): Promise<boolean> {
      // imapflow answers false for this too, as for a server that refuses.
      if (!keepsKeyword(client, keyword)) return false;
      requireDone(client, await client.messageFlagsAdd(String(uid), [keyword], BY_UID), `set ${keyword}`, uid);
      return true;
    },
    async moveMessage(uid: number, targetFolder: string): Promise<void> {
      requireLastingUids(client);
      // Without MOVE imapflow copies the email and then removes it.
      if (!client.capabilities.has('MOVE')) requireUidExpunge(client, 'MARK_READ');
      requireDone(client, await client.messageMove(String(uid), targetFolder, BY_UID), `move to "${targetFolder}"`, uid);
    },
    async deleteMessage(uid: number): Promise<void> {
      requireLastingUids(client);
      requireUidExpunge(client, 'MARK_READ or MOVE');
      requireDone(client, await client.messageDelete(String(uid), BY_UID), 'delete', uid);
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
