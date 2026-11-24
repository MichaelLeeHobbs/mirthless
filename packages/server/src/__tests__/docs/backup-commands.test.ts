// The documented backups could not be restored (#361): `docker exec -t` gave pg_dump a TTY,
// which wrote every newline byte of the binary dump as CR LF, and pg_dump still exited 0.
// GitHub Actions also runs the scripts and the commands as the pages print them. Elsewhere
// that needs BACKUP_DOCS_DOCKER=1, since it starts a container.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPO_ROOT, readRepoFile } from '../../../test/markdown.js';

const BACKUP_PAGE = 'docs/ops/backup-restore.md';
const UPGRADE_PAGE = 'docs/ops/upgrade.md';
const EXAMPLE_DUMP = '/backups/galvanigraph-20260712-020000.dump';
const RUN_DOCKER = process.env['GITHUB_ACTIONS'] === 'true' || process.env['BACKUP_DOCS_DOCKER'] === '1';

function fences(page: string): readonly string[] {
  return [...readRepoFile(page).replaceAll('\r\n', '\n').matchAll(/^ *```[^\n]*\n([\s\S]*?)^ *```$/gm)].map((m) => m[1] ?? '');
}

function fenceWith(page: string, text: string): string {
  const found = fences(page).filter((f) => f.includes(text));
  expect(found, `one block in ${page} with: ${text}`).toHaveLength(1);
  return found[0] ?? '';
}

const IMAGE = /postgres:[\w.-]+/;

describe('the backup pages and scripts', () => {
  it('leave pg_dump to docker/backup.sh, so nobody pastes a command that gives it a TTY', () => {
    const pages = readdirSync(join(REPO_ROOT, 'docs/ops')).filter((f) => f.endsWith('.md')).map((f) => `docs/ops/${f}`);
    const blocks = pages.flatMap((page) => fences(page).map((block) => ({ page, block })));

    expect(blocks.some((b) => b.block.includes('docker/backup.sh'))).toBe(true);
    expect(blocks.filter((b) => b.block.includes('pg_dump'))).toEqual([]);
  });

  it('check a dump with the version of Postgres that wrote it', () => {
    const production = IMAGE.exec(readRepoFile('docker/docker-compose.prod.yml'))?.[0];

    expect(production).toBeDefined();
    expect(/^image=(.+)$/m.exec(readRepoFile('docker/check-dump.sh'))?.[1]).toBe(production);
  });

  it('keep the backup before an upgrade in a block of its own, apart from the commands that migrate', () => {
    expect(fenceWith(UPGRADE_PAGE, 'docker/backup.sh').trim()).toBe('sh docker/backup.sh /backups');
  });

  it('schedule the backup with a line cron runs whole', () => {
    const line = fenceWith(BACKUP_PAGE, '* * *').trim();

    expect(line).toMatch(/^\d+ \d+ \* \* \* sh /);
    expect(line, 'one line, and cron ends the command at a %').not.toMatch(/[\n%]/);
  });
});

describe.skipIf(!RUN_DOCKER)('the documented backups, run against Postgres', { timeout: 120_000 }, () => {
  const container = `galvanigraph-backup-docs-${randomUUID()}`;
  let backups = '';

  interface Run {
    readonly status: number | null;
    readonly output: string;
  }

  function sh(command: string, env: Readonly<Record<string, string>> = {}): Run {
    const result = spawnSync('sh', ['-c', command], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 110_000,
      // Git Bash on Windows would rewrite /dev/null in a container's arguments.
      env: { ...process.env, MSYS_NO_PATHCONV: '1', DB_CONTAINER: container, ...env },
    });
    if (result.error) throw result.error;
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  function ok(command: string): string {
    const run = sh(command);
    expect(run.status, `${command}\n${run.output}`).toBe(0);
    return run.output;
  }

  /** The restore drops the database it runs against, so a docker command may only reach the throwaway container. */
  function documented(command: string): string {
    const aimed = command
      .replaceAll(EXAMPLE_DUMP, `${backups}/example.dump`).replaceAll('/backups', backups)
      .replaceAll('/opt/galvanigraph', REPO_ROOT.replaceAll('\\', '/'))
      .replaceAll('galvanigraph-db-prod', container)
      .replaceAll(/docker compose [^&\n]*/g, 'true ');
    const rest = aimed.replaceAll(`docker exec ${container} `, '').replaceAll(`docker exec -i ${container} `, '');
    if (/\bdocker\s/.test(rest)) throw new Error(`A docker command outside the throwaway container:\n${aimed}`);
    return aimed;
  }

  function sql(query: string): string {
    return ok(`docker exec ${container} psql -At -v ON_ERROR_STOP=1 -U galvanigraph -d galvanigraph -c "${query}"`).trim();
  }

  function fingerprint(): string {
    return sql("SELECT count(*), md5(string_agg(body || encode(raw, 'hex'), '' ORDER BY id)) FROM channels");
  }

  const path = (file: string): string => join(backups, file);
  const age = (file: string, days: number): void => { utimesSync(path(file), new Date(), new Date(Date.now() - days * 86_400_000)); };
  const check = (file: string): Run => sh(`sh docker/check-dump.sh "${backups}/${file}"`);
  const cron = (): string => documented(fenceWith(BACKUP_PAGE, '* * *').trim().replace(/^(?:\S+ ){5}/, ''));

  function newDump(): string {
    const files = readdirSync(backups).filter((f) => /^galvanigraph-\d{8}-\d{6}\.dump$/.test(f));
    expect(files).toHaveLength(1);
    return files[0] ?? '';
  }

  function restoreExample(): void {
    const output = ok(documented(fenceWith(BACKUP_PAGE, 'DROP DATABASE')));
    expect(output).toContain('restored:');
  }

  /** A dump as `docker exec` without -t writes it. */
  function goodDump(): Buffer {
    ok(`docker exec ${container} pg_dump -U galvanigraph -d galvanigraph -F c > "${backups}/good.dump"`);
    return readFileSync(path('good.dump'));
  }

  function throughTty(dump: Buffer): Buffer {
    const out: number[] = [];
    for (const byte of dump) {
      if (byte === 0x0a) out.push(0x0d);
      out.push(byte);
    }
    return Buffer.from(out);
  }

  /** The archive header holds sec, min, hour, day, month (from 0) and year, each as a sign byte and four bytes, low first. */
  function dumpedIn(dump: Buffer, month: number): Buffer {
    expect([...dump.subarray(5, 7)], 'archive version the offsets are for').toEqual([1, 16]);
    expect(dump.readInt32LE(38)).toBe(new Date().getUTCFullYear() - 1900);
    const copy = Buffer.from(dump);
    [30, 30, 12, 15, month].forEach((value, i) => copy.writeInt32LE(value, 13 + i * 5));
    return copy;
  }

  /** After the year come the DST flag, three strings (length, then bytes) and the number of entries. */
  function withoutEntries(dump: Buffer): Buffer {
    const copy = Buffer.from(dump);
    let at = 47;
    for (let i = 0; i < 3; i++) at += 5 + copy.readInt32LE(at + 1);
    expect(copy.readInt32LE(at + 1)).toBeGreaterThan(0);
    expect(copy.readInt32LE(at + 1)).toBeLessThan(100);
    copy.writeInt32LE(0, at + 1);
    return copy;
  }

  const JULY = 6;
  const NOVEMBER = 10;

  beforeAll(async () => {
    backups = mkdtempSync(join(tmpdir(), 'backup-docs-')).replaceAll('\\', '/');
    const image = IMAGE.exec(readRepoFile('docker/docker-compose.prod.yml'))?.[0] ?? '';
    ok(`docker image inspect ${image} > /dev/null 2>&1 || docker pull -q ${image}`);
    const env = '-e POSTGRES_USER=galvanigraph -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=galvanigraph';
    ok(`docker run -d --rm --name ${container} ${env} ${image}`);
    // Over TCP: the server the image starts to initialise listens on its socket only.
    await vi.waitFor(() => { ok(`docker exec ${container} pg_isready -h 127.0.0.1 -U galvanigraph`); }, { timeout: 60_000, interval: 500 });
  }, 300_000);

  afterAll(() => {
    sh(`docker rm -f -v ${container}`);
    rmSync(backups, { recursive: true, force: true });
  }, 120_000);

  beforeEach(() => {
    for (const entry of readdirSync(backups)) rmSync(path(entry), { recursive: true });
    sql(`DROP TABLE IF EXISTS channels;
      CREATE TABLE channels (id int PRIMARY KEY, body text, raw bytea);
      INSERT INTO channels SELECT g, 'line ' || g || E'\\n' || random(), sha256(g::text::bytea) FROM generate_series(1, 5000) g`);
  }, 120_000);

  it('the recommended backup restores every row', () => {
    const before = fingerprint();

    expect(ok(documented(fenceWith(UPGRADE_PAGE, 'docker/backup.sh')))).toContain('dump OK');
    writeFileSync(path('example.dump'), readFileSync(path(newDump())));
    sql('TRUNCATE channels');
    restoreExample();

    expect(before).toMatch(/^5000\|/);
    expect(fingerprint()).toBe(before);
  });

  it('a backup that fails leaves no file and prints no go-ahead', () => {
    const run = sh(`sh docker/backup.sh "${backups}"`, { DB_CONTAINER: `${container}-missing` });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain('dump OK');
    expect(readdirSync(backups)).toEqual([]);
  });

  it('a backup of a database without the GalvaniGraph tables is refused', () => {
    const run = sh(`sh docker/backup.sh "${backups}"`, { POSTGRES_DB: 'postgres' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('NOT OK');
    expect(readdirSync(backups)).toEqual([]);
  });

  it('the cron job deletes only dumps past their age, and none when the backup fails', () => {
    const kept = ['galvanigraph-recent.dump', 'galvanigraph-old.dump.gpg', 'galvanigraph-old.dump.repaired', 'yearly/galvanigraph-old.dump'];
    mkdirSync(path('yearly'));
    for (const file of [...kept, 'galvanigraph-old.dump']) {
      writeFileSync(path(file), 'x');
      age(file, file.includes('recent') ? 10 : 30);
    }

    expect(sh(cron(), { DB_CONTAINER: `${container}-missing` }).status).not.toBe(0);
    expect(existsSync(path('galvanigraph-old.dump'))).toBe(true);

    ok(cron());
    expect(existsSync(path('galvanigraph-old.dump'))).toBe(false);
    expect(kept.filter((file) => !existsSync(path(file)))).toEqual([]);
    newDump();
  });

  it('the check accepts a whole dump and refuses a cut or empty one', () => {
    const dump = goodDump();
    writeFileSync(path('cut.dump'), dump.subarray(0, Math.floor(dump.length * 0.9)));
    writeFileSync(path('empty.dump'), '');

    expect(check('good.dump')).toMatchObject({ status: 0, output: expect.stringContaining('dump OK') as string });
    for (const file of ['cut.dump', 'empty.dump', 'missing.dump']) {
      const run = check(file);
      expect(run.status, file).not.toBe(0);
      expect(run.output, file).not.toContain('dump OK');
    }
  });

  it.each([['July', JULY], ['November', NOVEMBER]])('the check refuses a dump taken through a TTY in %s', (_name, month) => {
    writeFileSync(path('tty.dump'), throughTty(dumpedIn(goodDump(), month)));

    const run = check('tty.dump');

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('NOT OK');
  });

  it('the check refuses a dump that pg_restore reads as an empty archive, as it does some taken through a TTY', () => {
    writeFileSync(path('no-entries.dump'), withoutEntries(goodDump()));

    expect(sh(`docker exec -i ${container} pg_restore -f /dev/null < "${backups}/no-entries.dump"`).status).toBe(0);
    const run = check('no-entries.dump');

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('NOT OK');
  });

  it.each([['July', JULY], ['November', NOVEMBER]])('the documented repair undoes the damage to a dump taken in %s exactly', (_name, month) => {
    const original = dumpedIn(goodDump(), month);
    writeFileSync(path('example.dump'), throughTty(original));

    expect(ok(documented(fenceWith(BACKUP_PAGE, 'perl')))).toContain('dump OK');

    expect(readFileSync(path('example.dump.repaired')).equals(original)).toBe(true);
    expect(readFileSync(path('example.dump')).equals(throughTty(original))).toBe(true);
  });

  it('the damage the repair undoes is the one a TTY does', () => {
    ok(`docker exec -t ${container} pg_dump -U galvanigraph -d galvanigraph -F c > "${backups}/example.dump"`);

    expect(ok(documented(fenceWith(BACKUP_PAGE, 'perl')))).toContain('dump OK');
  });

  it('the documented repair leaves a good dump alone', () => {
    const dump = goodDump();
    writeFileSync(path('example.dump'), dump);

    const run = sh(documented(fenceWith(BACKUP_PAGE, 'perl')));

    expect(run.output).toContain('leave it as it is');
    expect(run.output).not.toContain('dump OK');
    expect(existsSync(path('example.dump.repaired'))).toBe(false);
    expect(readFileSync(path('example.dump')).equals(dump)).toBe(true);
  });

  it('the documented restore drops nothing when the dump is damaged', () => {
    const before = fingerprint();
    writeFileSync(path('example.dump'), throughTty(dumpedIn(goodDump(), NOVEMBER)));

    const run = sh(documented(fenceWith(BACKUP_PAGE, 'DROP DATABASE')));

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain('restored:');
    expect(fingerprint()).toBe(before);
  });
});
