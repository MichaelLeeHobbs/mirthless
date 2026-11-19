import type { SystemInfo } from '../hooks/use-system-info.js';
import type { StatusLevel } from './status.js';

export interface HealthCell {
  readonly key: 'server' | 'database' | 'engine' | 'memory' | 'host';
  readonly label: string;
  readonly level: StatusLevel;
  /** Carries the level without colour. */
  readonly word: string;
  readonly summary: string;
}

/** A probe slower than this means the database is struggling, not down. */
export const SLOW_DB_MS = 250;

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes <= 0) return '0 B';
  const exponent = Math.floor(Math.log(bytes) / Math.log(1024));
  const i = Math.min(Math.max(exponent, 0), UNITS.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${UNITS[i]}`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

export function percentOf(used: number, total: number): number {
  return total > 0 ? Math.min((used / total) * 100, 100) : 0;
}

export function usageLevel(percent: number): StatusLevel {
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'warning';
  return 'healthy';
}

/** Windows has no load average; os.loadavg() answers zeros there. */
export function hasLoadAverage(info: SystemInfo): boolean {
  return info.os.platform !== 'win32';
}

function databaseCell(db: SystemInfo['database'], audit: SystemInfo['audit']): HealthCell {
  if (!db.connected) {
    return { key: 'database', label: 'Database', level: 'critical', word: 'Unreachable', summary: 'The probe query failed. Messages cannot be stored.' };
  }
  const stray = audit.rowsOutsideMonths ?? 0;
  if (stray > 0) {
    // The server counts up to 10,000.
    const rows = stray === 1 ? '1 audit row' : stray >= 10_000 ? '10,000+ audit rows' : `${String(stray)} audit rows`;
    return { key: 'database', label: 'Database', level: 'warning', word: 'Attention', summary: `${rows} outside a monthly partition: see the audit log runbook` };
  }
  if (audit.lostRecords > 0) {
    const lost = audit.lostRecords === 1 ? '1 audit record' : `${String(audit.lostRecords)} audit records`;
    return { key: 'database', label: 'Database', level: 'warning', word: 'Attention', summary: `${lost} could not be written since the server started: see the server log` };
  }
  const version = db.version ? `PostgreSQL ${db.version}` : 'PostgreSQL';
  const latency = db.latencyMs === null ? '' : ` · ${db.latencyMs} ms`;
  const slow = db.latencyMs !== null && db.latencyMs >= SLOW_DB_MS;
  return { key: 'database', label: 'Database', level: slow ? 'warning' : 'healthy', word: slow ? 'Slow' : 'Connected', summary: `${version}${latency}` };
}

function engineCell(engine: SystemInfo['engine']): HealthCell {
  if (engine.deployed === 0) {
    return { key: 'engine', label: 'Engine', level: 'neutral', word: 'Idle', summary: 'No channels deployed.' };
  }
  const parts = [`${engine.started} of ${engine.deployed} started`];
  if (engine.paused > 0) parts.push(`${engine.paused} paused`);
  if (engine.stopped > 0) parts.push(`${engine.stopped} stopped`);
  const attention = engine.paused + engine.stopped > 0;
  return { key: 'engine', label: 'Engine', level: attention ? 'warning' : 'healthy', word: attention ? 'Attention' : 'Running', summary: parts.join(' · ') };
}

function memoryCell(memory: SystemInfo['memory']): HealthCell {
  const percent = percentOf(memory.heapUsed, memory.heapLimit);
  const level = usageLevel(percent);
  const word = level === 'healthy' ? 'OK' : level === 'warning' ? 'High' : 'Critical';
  return { key: 'memory', label: 'Heap', level, word, summary: `${formatBytes(memory.heapUsed)} of ${formatBytes(memory.heapLimit)} (${percent.toFixed(0)}%)` };
}

function hostCell(info: SystemInfo): HealthCell {
  const percent = percentOf(info.os.totalMemory - info.os.freeMemory, info.os.totalMemory);
  const memLevel = usageLevel(percent);
  const perCpu = info.os.cpus > 0 ? info.os.loadAverage[0] / info.os.cpus : 0;
  const busy = hasLoadAverage(info) && perCpu >= 1;
  const level: StatusLevel = memLevel === 'critical' ? 'critical' : memLevel === 'warning' || busy ? 'warning' : 'healthy';
  const word = level === 'healthy' ? 'OK' : level === 'warning' ? 'Busy' : 'Critical';
  const load = hasLoadAverage(info) ? ` · load ${info.os.loadAverage[0].toFixed(2)} on ${info.os.cpus} CPUs` : ` · ${info.os.cpus} CPUs`;
  return { key: 'host', label: 'Host', level, word, summary: `Memory ${percent.toFixed(0)}% used${load}` };
}

export function healthCells(info: SystemInfo): readonly HealthCell[] {
  return [
    { key: 'server', label: 'Server', level: 'healthy', word: 'Running', summary: `v${info.server.version} · up ${formatUptime(info.server.uptime)}` },
    databaseCell(info.database, info.audit),
    engineCell(info.engine),
    memoryCell(info.memory),
    hostCell(info),
  ];
}

/** For support tickets: no message content, settings values or credentials. */
export function diagnosticsText(info: SystemInfo, now: Date): string {
  const { server, os, memory, engine, database } = info;
  const load = hasLoadAverage(info) ? os.loadAverage.map((n) => n.toFixed(2)).join(' / ') : 'n/a';
  return [
    `GalvaniGraph system information (${now.toISOString()})`,
    '',
    `Server     v${server.version} · ${server.env} · Node.js ${server.nodeVersion}`,
    `Process    pid ${server.pid} on ${server.hostname} · up ${formatUptime(server.uptime)} (since ${server.startedAt})`,
    `Database   ${database.connected ? `connected · PostgreSQL ${database.version ?? 'unknown'} · ${database.latencyMs ?? '?'} ms · ${database.sizeBytes === null ? 'size unknown' : formatBytes(database.sizeBytes)}` : 'UNREACHABLE'}`,
    `Engine     ${engine.deployed} deployed · ${engine.started} started · ${engine.paused} paused · ${engine.stopped} stopped`,
    `Memory     heap ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapLimit)} limit · rss ${formatBytes(memory.rss)} · external ${formatBytes(memory.external)}`,
    `Host       ${os.platform} ${os.release} ${os.arch} · ${os.cpus} CPUs · load ${load} · memory ${formatBytes(os.totalMemory - os.freeMemory)} / ${formatBytes(os.totalMemory)}`,
  ].join('\n');
}
