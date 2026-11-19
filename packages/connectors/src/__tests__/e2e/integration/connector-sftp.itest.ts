import { it, expect, afterEach } from 'vitest';
import SftpLibrary from 'ssh2-sftp-client';
import {
  SftpReceiver,
  SftpDispatcher,
  SFTP_POST_ACTION,
  clearChannelRegistry,
  createSsh2SftpClient,
} from '../../../index.js';
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from '../support/e2e-harness.js';
import { mllpSource, sendMllp } from '../support/tcp-helpers.js';
import { describeSftp, requireSftp } from './gates.js';

const TCP_PORT = 17741;

interface RawSession {
  readonly sftp: { symlink(targetPath: string, linkPath: string, cb: (err: Error | null | undefined) => void): void };
}

let deployed: DeployedChannel[] = [];
afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  clearChannelRegistry();
});

describeSftp('SFTP connector cascade (real SFTP server)', () => {
  it('Channel A uploads via SFTP destination; Channel B\'s SFTP source picks it up', async () => {
    const cfg = requireSftp();
    const conn = {
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      strictHostKey: false,
    };

    const sink = new CaptureDestination();

    const channelB = await deployChannel({
      channelId: '00000000-0000-0000-0000-connsftp000b',
      dataType: 'RAW',
      source: new SftpReceiver({
        ...conn,
        remoteDirectory: cfg.baseDir,
        filePattern: '*.hl7',
        pollingIntervalMs: 200,
        afterProcessing: SFTP_POST_ACTION.DELETE,
        moveToDirectory: '',
        minFileAgeMs: 0,
        ignoreDot: true,
      }),
      transformer: "return String(msg) + '::sftp';",
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });

    const channelA = await deployChannel({
      channelId: '00000000-0000-0000-0000-connsftp000a',
      dataType: 'RAW',
      source: mllpSource(TCP_PORT, { maxConnections: 10 }),
      destinations: [{
        metaDataId: 1,
        name: 'SFTP Out',
        connector: new SftpDispatcher({
          ...conn,
          remoteDirectory: cfg.baseDir,
          fileNameTemplate: 'msg-${messageId}.hl7',
          appendMode: false,
        }),
      }],
    });
    deployed.push(channelA, channelB);

    await sendMllp(TCP_PORT, 'MSH|^~\\&|SFTPTEST');

    for (let i = 0; i < 300 && sink.received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(sink.received).toHaveLength(1);
    expect(sink.lastContent()).toBe('MSH|^~\\&|SFTPTEST::sftp');
  });

  it('tells a directory from a regular file and a missing path (#133)', async () => {
    const cfg = requireSftp();
    const client = createSsh2SftpClient({
      host: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password, strictHostKey: false,
    });
    const filePath = `${cfg.baseDir}/pathkind-${String(Date.now())}.txt`;
    await client.connect();
    try {
      await client.put(Buffer.from('x'), filePath);

      expect(await client.pathKind(cfg.baseDir)).toBe('directory');
      expect(await client.pathKind(filePath)).toBe('file');
      expect(await client.pathKind(`${cfg.baseDir}/no-such-entry`)).toBe('missing');
    } finally {
      await client.delete(filePath).catch(() => undefined);
      await client.end();
    }
  });

  it('treats a link to a directory as a directory, and writes through it (#133)', async () => {
    const cfg = requireSftp();
    const conn = { host: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password };
    const stamp = String(Date.now());
    const realDir = `${cfg.baseDir}/real-${stamp}`;
    const linkDir = `${cfg.baseDir}/link-${stamp}`;
    // Our SftpClient cannot make links, so the raw library sets one up (relative target, inside the chroot).
    const raw = new SftpLibrary();
    await raw.connect(conn);
    const client = createSsh2SftpClient({ ...conn, strictHostKey: false });
    await client.connect();
    try {
      await raw.mkdir(realDir);
      // The library's types omit its ssh2 session; ssh2 swaps the arguments for OpenSSH servers itself.
      const session = (raw as unknown as RawSession).sftp;
      await new Promise<void>((resolve, reject) => {
        session.symlink(`real-${stamp}`, linkDir, (err) => { if (err) reject(err); else resolve(); });
      });

      expect(await client.pathKind(linkDir)).toBe('directory');
      await client.mkdir(linkDir);
      await client.put(Buffer.from('through the link'), `${linkDir}/msg.txt`);
      expect(await client.pathKind(`${realDir}/msg.txt`)).toBe('file');
    } finally {
      await raw.delete(`${realDir}/msg.txt`).catch(() => undefined);
      await raw.delete(linkDir).catch(() => undefined);
      await raw.rmdir(realDir).catch(() => undefined);
      await client.end();
      await raw.end();
    }
  });
});
