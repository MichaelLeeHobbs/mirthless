import { DatabaseReceiver, type DatabaseReceiverConfig, type PoolConfig, type RawMessage } from '../../../index.js';
import { makeMockLogger, type MockLogger } from '../../../__fixtures__/mock-logger.js';

type Row = Readonly<Record<string, unknown>>;

export interface RunningSource {
  readonly receiver: DatabaseReceiver;
  readonly log: MockLogger;
  /** The rows dispatched so far, as the message text holds them. */
  readonly rows: readonly Row[];
}

type SourceSettings = Pick<DatabaseReceiverConfig, 'selectQuery'> & Partial<DatabaseReceiverConfig>;

/** A started DATABASE source that polls every 100 ms. `onRow` runs while the row is in the pipeline. */
export async function startSource(
  pool: PoolConfig,
  settings: SourceSettings,
  onRow: (row: Row) => Promise<void> = async () => {},
): Promise<RunningSource> {
  const rows: Row[] = [];
  const log = makeMockLogger();
  const receiver = new DatabaseReceiver({
    host: pool.host,
    port: pool.port,
    database: pool.database,
    username: pool.user,
    password: pool.password,
    updateQuery: '',
    updateMode: settings.updateQuery ? 'ON_SUCCESS' : 'NEVER',
    pollingIntervalMs: 100,
    rowFormat: 'JSON',
    ...settings,
  }, undefined, log.logger);
  receiver.setDispatcher(async (raw: RawMessage) => {
    const row = JSON.parse(raw.content) as Row;
    rows.push(row);
    await onRow(row);
    return { ok: true, value: { messageId: rows.length }, error: null };
  });
  const started = await receiver.onStart();
  if (!started.ok) throw started.error;
  return { receiver, log, rows };
}

export async function stopSource(source: RunningSource | null): Promise<void> {
  await source?.receiver.onStop();
  await source?.receiver.onUndeploy();
}

/** A promise and what resolves it. */
export function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open = (): void => {};
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}
