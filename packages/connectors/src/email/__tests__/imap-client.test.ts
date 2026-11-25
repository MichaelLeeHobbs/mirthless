import { describe, it, expect, vi, type Mock } from 'vitest';
import { ImapRefusal, wrapImapFlow, type ImapFlowFetchMessage, type ImapFlowInstance } from '../imap-client.js';

interface FakeFlow {
  readonly flow: ImapFlowInstance;
  readonly messageDelete: Mock;
  readonly messageMove: Mock;
  readonly messageFlagsAdd: Mock;
}

function fakeFlow(capabilities: readonly string[] = ['UIDPLUS', 'MOVE'], rows: readonly ImapFlowFetchMessage[] = []): FakeFlow {
  const messageDelete = vi.fn().mockResolvedValue(true);
  const messageMove = vi.fn().mockResolvedValue({ path: 'INBOX' });
  const messageFlagsAdd = vi.fn().mockResolvedValue(true);
  const flow: ImapFlowInstance = {
    connect: async () => undefined,
    on: () => undefined,
    getMailboxLock: async () => ({ release: () => undefined }),
    async *fetch() { yield* rows; },
    messageFlagsAdd,
    messageMove,
    messageDelete,
    capabilities: new Map(capabilities.map((name) => [name, true])),
    mailbox: { uidValidity: 17n },
    logout: async () => undefined,
    close: () => undefined,
  };
  return { flow, messageDelete, messageMove, messageFlagsAdd };
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

  it.each([[false], [undefined]])('fails when imapflow answers %s', async (answer) => {
    const { flow, messageDelete } = fakeFlow();
    messageDelete.mockResolvedValue(answer);
    await expect(wrapImapFlow(flow).deleteMessage(4)).rejects.toThrow(ImapRefusal);
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
    const [email] = await wrapImapFlow(flow).fetchUnread('INBOX');
    expect(email).toMatchObject({ uid: 4, uidValidity: '17', subject: 'ORU', source: Buffer.from('raw'), dispatched: false, held: false });
  });

  it.each([
    ['only its flags', { uid: 4, flags: new Set(['\\Seen']) }],
    ['no flags', { ...ROW, flags: undefined }],
    ['no envelope', { ...ROW, envelope: undefined }],
    ['no source', { ...ROW, source: undefined }],
    ['an empty source', { ...ROW, source: Buffer.alloc(0) }],
    ['no UID', { ...ROW, uid: undefined }],
    ['a UID that is none', { ...ROW, uid: 0 }],
  ] as ReadonlyArray<readonly [string, ImapFlowFetchMessage]>)('takes a row with %s for no email', async (_what, row) => {
    const { flow } = fakeFlow([], [row]);
    expect(await wrapImapFlow(flow).fetchUnread('INBOX')).toEqual([]);
  });

  it('takes an email once although a change of its flags comes with it', async () => {
    const { flow } = fakeFlow([], [ROW, { uid: 4, flags: new Set(['\\Seen']) }]);
    expect(await wrapImapFlow(flow).fetchUnread('INBOX')).toHaveLength(1);
  });

  it('fails when the folder is not open', async () => {
    const { flow } = fakeFlow();
    await expect(wrapImapFlow({ ...flow, mailbox: false }).fetchUnread('INBOX')).rejects.toThrow('"INBOX" is not open');
  });
});
