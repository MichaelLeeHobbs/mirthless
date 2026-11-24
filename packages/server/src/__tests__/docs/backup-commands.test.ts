// The documented backups could not be restored (#361): `docker exec -t` gave pg_dump a TTY,
// which wrote every newline byte of the binary dump as CR LF, and pg_dump still exited 0.
// GitHub Actions also runs the commands as the pages print them. Elsewhere that needs
// BACKUP_DOCS_DOCKER=1, since it starts a container.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPO_ROOT, readRepoFile } from '../../../test/markdown.js';

const BACKUP_PAGE = 'docs/ops/backup-restore.md';
const UPGRADE_PAGE = 'docs/ops/upgrade.md';
const EXAMPLE_DUMP = 'galvanigraph-20260712-020000.dump';
const DOCUMENTED_CONTAINER = 'galvanigraph-db-prod';
const CONTAINER = `galvanigraph-backup-docs-${String(process.pid)}`;
const RUN_DOCKER = process.env['GITHUB_ACTIONS'] === 'true' || process.env['BACKUP_DOCS_DOCKER'] === '1';

interface Run {
  readonly status: number | null;
  readonly output: string;
}

function fences(page: string, language: string): readonly string[] {
  const text = readRepoFile(page).replaceAll('\r\n', '\n');
  return [...text.matchAll(/^ *```(\w+)\n([\s\S]*?)^ *```$/gm)].filter((m) => m[1] === language).map((m) => m[2] ?? '');
}

function fenceWith(page: string, language: string, text: string): string {
  const found = fences(page, language).filter((f) => f.includes(text));
  expect(found, `one ${language} block in ${page} with "${text}"`).toHaveLength(1);
  return found[0] ?? '';
}

describe('docker exec in the operations pages', () => {
  const pages = readdirSync(join(REPO_ROOT, 'docs/ops')).filter((f) => f.endsWith('.md')).map((f) => `docs/ops/${f}`);
  const commands = pages.flatMap((page) => fences(page, 'bash').concat(fences(page, 'cron'))
    .flatMap((block) => [...block.matchAll(/docker exec((?:\s+-\S+)*)/g)].map((m) => ({ page, command: m[0] }))));

  it('is used by the backup and upgrade pages', () => {
    expect(new Set(commands.map((c) => c.page))).toEqual(new Set([BACKUP_PAGE, UPGRADE_PAGE]));
  });

  it('never asks for a TTY, which changes the bytes a dump is saved with', () => {
    const withTty = commands.filter((c) => /\s(?:-[a-z]*t[a-z]*|--tty)(?=\s|$)/.test(c.command));
    expect(withTty, 'remove -t (#361)').toEqual([]);
  });
});

describe.skipIf(!RUN_DOCKER)('the documented backup commands, run against Postgres', { timeout: 120_000 }, () => {
  let dir = '';

  /** Aims the command at the throwaway container: the restore drops the database it runs against. */
  function documented(command: string): string {
    const aimed = command.replaceAll(DOCUMENTED_CONTAINER, CONTAINER);
    for (const m of aimed.matchAll(/docker exec(?:\s+-\S+)*\s+(\S+)/g)) {
      if (m[1] !== CONTAINER) throw new Error(`Not the throwaway container: ${m[0]}`);
    }
    return aimed;
  }

  function bash(command: string): Run {
    const result = spawnSync('bash', ['-c', command], {
      cwd: dir, encoding: 'utf8', timeout: 60_000,
      // Git Bash on Windows would rewrite /dev/null in a container's arguments.
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
    if (result.error) throw result.error;
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  function ok(command: string): string {
    const run = bash(command);
    expect(run.status, `${command}\n${run.output}`).toBe(0);
    return run.output;
  }

  function sql(query: string): string {
    return ok(`docker exec ${CONTAINER} psql -At -v ON_ERROR_STOP=1 -U galvanigraph -d galvanigraph -c "${query}"`).trim();
  }

  function fingerprint(): string {
    return sql("SELECT count(*), md5(string_agg(body || encode(raw, 'hex'), '' ORDER BY id)) FROM m");
  }

  const dumps = (): readonly string[] => readdirSync(dir).filter((f) => f.includes('dump'));

  const takeDump = (): string => documented(fenceWith(BACKUP_PAGE, 'bash', 'pg_dump'));

  const check = (file: string): string => documented(fenceWith(BACKUP_PAGE, 'bash', '&& echo "dump OK"')).replaceAll(EXAMPLE_DUMP, file);

  function cronJob(): string {
    const line = fenceWith(BACKUP_PAGE, 'cron', 'pg_dump').trim();
    expect(line.split('\n'), 'a cron job is one line').toHaveLength(1);
    const command = /^(?:\S+\s+){5}(.+)$/.exec(line)?.[1] ?? '';
    mkdirSync(join(dir, 'backups'));
    return documented(command).replaceAll('\\%', '%').replaceAll('/backups', './backups');
  }

  function upgradeStep(): string {
    const lines = fenceWith(UPGRADE_PAGE, 'bash', 'pg_dump').split('\n');
    return documented(lines.filter((l) => l.trimStart().startsWith('docker exec')).join('\n'));
  }

  function restore(file: string): void {
    const block = fenceWith(BACKUP_PAGE, 'bash', 'DROP DATABASE');
    expect(block).toContain(EXAMPLE_DUMP);
    const onlyDatabase = block.split('\n').filter((l) => !l.startsWith('docker compose')).join('\n');
    ok(`set -e\n${documented(onlyDatabase).replaceAll(EXAMPLE_DUMP, file)}`);
  }

  function writeTtyDump(file: string): void {
    ok(`docker exec -t ${CONTAINER} pg_dump -U galvanigraph -d galvanigraph -F c > ${file}`);
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'backup-docs-'));
    const env = '-e POSTGRES_USER=galvanigraph -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=galvanigraph';
    ok(`docker run -d --name ${CONTAINER} ${env} postgres:17-alpine`);
    // Over TCP: the server the image starts to initialise listens on its socket only.
    await vi.waitFor(() => { ok(`docker exec ${CONTAINER} pg_isready -h 127.0.0.1 -U galvanigraph`); }, { timeout: 60_000, interval: 500 });
  }, 180_000);

  afterAll(() => {
    if (!dir) return;
    bash(`docker rm -f -v ${CONTAINER}`);
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  beforeEach(() => {
    for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true });
    sql(`DROP TABLE IF EXISTS m;
      CREATE TABLE m (id int PRIMARY KEY, body text, raw bytea);
      INSERT INTO m SELECT g, 'line ' || g || E'\\n' || random(), sha256(g::text::bytea) FROM generate_series(1, 5000) g`);
  }, 120_000);

  it.each([
    ['the recommended backup', takeDump, (): readonly string[] => dumps()],
    ['the cron job', cronJob, (): readonly string[] => readdirSync(join(dir, 'backups')).map((f) => `backups/${f}`)],
    ['the backup before an upgrade', upgradeStep, (): readonly string[] => dumps()],
  ])('%s restores every row', (_name, command, files) => {
    const before = fingerprint();

    ok(command());
    const [file, ...others] = files();
    expect(others).toEqual([]);
    expect(file).toMatch(/\.dump$/);
    sql('TRUNCATE m');
    restore(file ?? '');

    expect(before).toMatch(/^5000\|/);
    expect(fingerprint()).toBe(before);
  });

  it('a backup that cannot be read back is not given its final name', () => {
    const throughTty = takeDump().replace(`docker exec ${CONTAINER}`, `docker exec -t ${CONTAINER}`);
    expect(throughTty).toContain('exec -t');

    expect(bash(throughTty).status).not.toBe(0);

    expect(dumps()).toEqual([expect.stringMatching(/\.partial$/)]);
  });

  it('the cron job deletes old dumps only once the new one has been read back', () => {
    const command = cronJob();
    const throughTty = command.replace(`docker exec ${CONTAINER}`, `docker exec -t ${CONTAINER}`);
    ok('touch -d "30 days ago" backups/galvanigraph-old.dump backups/galvanigraph-failed.dump.partial');

    expect(bash(throughTty).status).not.toBe(0);
    expect(readdirSync(join(dir, 'backups'))).toContain('galvanigraph-old.dump');

    ok(command);
    expect(readdirSync(join(dir, 'backups'))).toEqual([expect.stringMatching(/^galvanigraph-\d{8}\.dump$/)]);
  });

  it('the check before an upgrade does not print its go-ahead for a dump taken through a TTY', () => {
    const throughTty = upgradeStep().replace(`docker exec ${CONTAINER} pg_dump`, `docker exec -t ${CONTAINER} pg_dump`);
    expect(throughTty).toContain('exec -t');

    expect(bash(throughTty).output).not.toContain('dump OK');
  });

  it('the documented check accepts a whole dump and refuses a cut one', () => {
    ok(`docker exec ${CONTAINER} pg_dump -U galvanigraph -d galvanigraph -F c > whole.dump`);
    const whole = readFileSync(join(dir, 'whole.dump'));
    writeFileSync(join(dir, 'cut.dump'), whole.subarray(0, Math.floor(whole.length * 0.9)));

    expect(ok(check('whole.dump'))).toContain('dump OK');
    const cut = bash(check('cut.dump'));
    expect(cut.status).not.toBe(0);
    expect(cut.output).not.toContain('dump OK');
  });

  it('the documented repair makes a dump taken through a TTY restorable', () => {
    const before = fingerprint();
    writeTtyDump('tty.dump');
    expect(bash(check('tty.dump')).status).not.toBe(0);

    ok(fenceWith(BACKUP_PAGE, 'bash', 'perl').replaceAll(EXAMPLE_DUMP, 'tty.dump'));
    ok(check('repaired.dump'));
    sql('TRUNCATE m');
    restore('repaired.dump');

    expect(fingerprint()).toBe(before);
  });
});
