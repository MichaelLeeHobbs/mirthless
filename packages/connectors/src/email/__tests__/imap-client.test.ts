import { describe, it, expect, vi, type Mock } from 'vitest';
import { ImapRefusal, wrapImapFlow, type ImapFlowFetchMessage, type ImapFlowInstance } from '../imap-client.js';

interface FakeFlow {
  readonly flow: ImapFlowInstance;
  readonly ranges: readonly string[];
  readonly messageDelete: Mock;
  readonly messageMove: Mock;
  readonly messageFlagsAdd: Mock;
}

function fakeFlow(
  capabilities: readonly string[] = ['UIDPLUS', 'MOVE'],
  rows: readonly ImapFlowFetchMessage[] = [],
  uids: unknown = rows.map((row) => row.uid),
): FakeFlow {
  const ranges: string[] = [];
  const messageDelete = vi.fn().mockResolvedValue(true);
  const messageMove = vi.fn().mockResolvedValue({ path: 'INBOX' });
  const messageFlagsAdd = vi.fn().mockResolvedValue(true);
  const flow: ImapFlowInstance = {
    connect: async () => undefined,
    on: () => undefined,
    getMailboxLock: async () => ({ release: () => undefined }),
    search: async () => uids,
    async *fetch(range) { ranges.push(range); yield* rows; },
    messageFlagsAdd,
    messageMove,
    messageDelete,
    capabilities: new Map(capabilities.map((name) => [name, true])),
    mailbox: { uidValidity: 17n },
    usable: true,
    logout: async () => undefined,
    close: () => undefined,
  };
  return { flow, ranges, messageDelete, messageMove, messageFlagsAdd };
}

const ROW = { uid: 4, source: Buffer.from('raw'), envelope: { subject: 'ORU' }, flags: new Set<string>() };

describe('the IMAP client\'s deletion', () => {
  it('removes the one email, by its UID', async () => {
    const { flow, messageDelete } = fakeFlow();
    await wrapImapFlow(flow).deleteMessage(4);
    expect(messageDelete).toHaveBeenCalledExactlyOnceWith('4', { uid: true });
  });

  it('refuses before it flags anything when the server can only remove all flagged emails', async () => {
    const { flow, messageDelete, messageFlagsAdd } = fakeFlow(['MOVE']);
    await expect(wrapImapFlow(flow).deleteMessage(4)).rejects.toThrow(ImapRefusal);
    expect(messageDelete).not.toHaveBeenCalled();
    expect(messageFlagsAdd).not.toHaveBeenCalled();
  });

  it.each([[false], [undefined]])('is refused when imapflow answers %s', async (answer) => {
    const { flow, messageDelete } = fakeFlow();
    messageDelete.mockResolvedValue(answer);
    await expect(wrapImapFlow(flow).deleteMessage(4)).rejects.toThrow(ImapRefusal);
  });

  // imapflow answers false for a command it was running when the connection went.
  it.each([
    ['is gone', { usable: false }],
    ['has no folder open any more', { mailbox: false as const }],
    ['is being closed by the server', { byeReason: 'shutting down' }],
  ])('is no refusal when the connection %s', async (_what, state) => {
    const { flow, messageDelete } = fakeFlow();
    messageDelete.mockResolvedValue(false);
    const failure: unknown = await wrapImapFlow({ ...flow, ...state }).deleteMessage(4).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ImapRefusal);
  });

  it.each([{ usable: false }, { mailbox: false as const }, { byeReason: 'shutting down' }])('nor is it for a flag (%o)', async (state) => {
    const { flow, messageFlagsAdd } = fakeFlow();
    messageFlagsAdd.mockResolvedValue(false);
    const failure: unknown = await wrapImapFlow({ ...flow, ...state }).markRead(4).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ImapRefusal);
  });

  it.each(['deleteMessage', 'moveMessage'] as const)('%s is refused when the server does not say that UIDs last', async (action) => {
    const { flow, messageDelete, messageMove } = fakeFlow();
    await expect(wrapImapFlow({ ...flow, mailbox: {} })[action](4, 'Done')).rejects.toThrow(ImapRefusal);
    expect(messageDelete).not.toHaveBeenCalled();
    expect(messageMove).not.toHaveBeenCalled();
  });
});

describe('the IMAP client\'s move', () => {
  it.each([[['MOVE']], [['UIDPLUS']]])('moves the one email, by its UID, with %s', async (capabilities) => {
    const { flow, messageMove } = fakeFlow(capabilities);
    await wrapImapFlow(flow).moveMessage(4, 'Done');
    expect(messageMove).toHaveBeenCalledExactlyOnceWith('4', 'Done', { uid: true });
  });

  it('refuses when imapflow would copy the email and then remove all flagged ones', async () => {
    const { flow, messageMove } = fakeFlow([]);
    await expect(wrapImapFlow(flow).moveMessage(4, 'Done')).rejects.toThrow(ImapRefusal);
    expect(messageMove).not.toHaveBeenCalled();
  });
});

describe('the IMAP client\'s fetch', () => {
  it('reads an email with its folder\'s UIDVALIDITY', async () => {
    const { flow } = fakeFlow([], [ROW]);
    const unread = await wrapImapFlow(flow).fetchUnread('INBOX');
    expect(unread).toMatchObject({ uidValidity: '17', unreadable: [] });
    expect(unread.emails).toEqual([expect.objectContaining({ uid: 4, subject: 'ORU', source: Buffer.from('raw'), dispatched: false, held: false })]);
  });

  it.each([
    ['only its flags', { uid: 4, flags: new Set(['\\Seen']) }],
    ['no flags', { ...ROW, flags: undefined }],
    ['no source', { ...ROW, source: undefined }],
    ['an empty source', { ...ROW, source: Buffer.alloc(0) }],
  ] as ReadonlyArray<readonly [string, ImapFlowFetchMessage]>)('takes a row with %s for no email, and says that it could not be read', async (_what, row) => {
    const { flow } = fakeFlow([], [row]);
    expect(await wrapImapFlow(flow).fetchUnread('INBOX')).toEqual({ uidValidity: '17', emails: [], unreadable: [4] });
  });

  it('takes no email that the search did not list', async () => {
    const { flow } = fakeFlow([], [ROW, { ...ROW, uid: 5 }], [4]);
    const unread = await wrapImapFlow(flow).fetchUnread('INBOX');
    expect(unread.emails.map(({ uid }) => uid)).toEqual([4]);
    expect(unread.unreadable).toEqual([]);
  });

  it('reads an email without an envelope, and one whose date is no date', async () => {
    const { flow } = fakeFlow([], [{ uid: 4, source: ROW.source, flags: ROW.flags }, { ...ROW, uid: 5, envelope: { date: 'yesterday' } }]);
    const { emails } = await wrapImapFlow(flow).fetchUnread('INBOX');
    expect(emails.map(({ subject, date }) => [subject, date])).toEqual([['', ''], ['', 'yesterday']]);
  });

  it('takes an email once although a change of its flags comes with it', async () => {
    const { flow } = fakeFlow([], [ROW, { uid: 4, flags: new Set(['\\Seen']) }], [4]);
    expect((await wrapImapFlow(flow).fetchUnread('INBOX')).emails).toHaveLength(1);
  });

  it('fails, and is no empty folder, when the server refuses the search', async () => {
    const { flow } = fakeFlow([], [ROW], false);
    await expect(wrapImapFlow(flow).fetchUnread('INBOX')).rejects.toThrow('did not answer the search');
  });

  it('asks for many emails in commands of a length a server takes', async () => {
    const { flow, ranges } = fakeFlow([], [], Array.from({ length: 450 }, (_, i) => i + 1));
    await wrapImapFlow(flow).fetchUnread('INBOX');
    expect(ranges.map((range) => range.split(',').length)).toEqual([200, 200, 50]);
  });

  it('fails when the folder is not open', async () => {
    const { flow } = fakeFlow();
    await expect(wrapImapFlow({ ...flow, mailbox: false }).fetchUnread('INBOX')).rejects.toThrow('"INBOX" is not open');
  });
});

describe('the IMAP client\'s keyword', () => {
  const withPermanentFlags = (flow: ImapFlowInstance, permanentFlags?: ReadonlySet<string>): ImapFlowInstance =>
    ({ ...flow, mailbox: { uidValidity: 17n, ...(permanentFlags ? { permanentFlags } : {}) } });

  it.each([
    ['takes any', new Set(['\\*'])],
    ['lists it', new Set(['$GalvaniGraphError'])],
    ['does not say', undefined],
  ])('is set when the mailbox %s', async (_what, permanentFlags) => {
    const { flow, messageFlagsAdd } = fakeFlow();
    expect(await wrapImapFlow(withPermanentFlags(flow, permanentFlags)).mark(4, '$GalvaniGraphError')).toBe(true);
    expect(messageFlagsAdd).toHaveBeenCalledExactlyOnceWith('4', ['$GalvaniGraphError'], { uid: true });
  });

  it('is not set, and said to be refused, when the mailbox takes none', async () => {
    const { flow, messageFlagsAdd } = fakeFlow();
    expect(await wrapImapFlow(withPermanentFlags(flow, new Set(['\\Seen']))).mark(4, '$GalvaniGraphError')).toBe(false);
    expect(messageFlagsAdd).not.toHaveBeenCalled();
  });

  it('fails when the server does not set it, which imapflow answers as a mailbox that takes none', async () => {
    const { flow, messageFlagsAdd } = fakeFlow();
    messageFlagsAdd.mockResolvedValue(false);
    await expect(wrapImapFlow(flow).mark(4, '$GalvaniGraphError')).rejects.toThrow(ImapRefusal);
  });
});

describe('a folder without UIDVALIDITY', () => {
  it('is read', async () => {
    const { flow } = fakeFlow([], [ROW]);
    expect((await wrapImapFlow({ ...flow, mailbox: {} }).fetchUnread('INBOX')).emails).toHaveLength(1);
  });
});
