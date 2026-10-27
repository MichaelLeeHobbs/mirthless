// ===========================================
// System Health
// ===========================================
// Turns the /system snapshot into what the System Information page shows: a
// level, a word and a one-line reason for each part of the server, plus the
// plain-text summary that "Copy diagnostics" puts on the clipboard. Pure
// functions, no React, so the thresholds are easy to test.

import type { SystemInfo } from '../hooks/use-system-info.js';
import type { StatusLevel } from './status.js';

/** One cell of the status strip. */
export interface HealthCell {
  readonly key: 'server' | 'database' | 'engine' | 'memory' | 'host';
  readonly label: string;
  readonly level: StatusLevel;
  /** One or two words that carry the level without colour, e.g. "Connected". */
  readonly word: string;
  readonly summary: string;
}

/** A probe slower than this means the database is struggling, not down. */
export const SLOW_DB_MS = 250;

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1536 → "1.5 KB". Binary units, one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${UNITS[i]}`;
}

/** 93784 → "1d 2h 3m". Minutes are always shown, so a fresh start reads "0m". */
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

/** Share of `total` used, 0 to 100. Zero when the total is unknown. */
export function percentOf(used: number, total: number): number {
  return total > 0 ? Math.min((used / total) * 100, 100) : 0;
}

/** Level for a usage percentage: warning from 75%, critical from 90%. */
export function usageLevel(percent: number): StatusLevel {
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'warning';
  return 'healthy';
}

/** Windows has no load average; os.loadavg() answers zeros there. */
export function hasLoadAverage(info: SystemInfo): boolean {
  return info.os.platform !== 'win32';
}

function databaseCell(db: SystemInfo['database']): HealthCell {
  if (!db.connected) {
    return { key: 'database', label: 'Database', level: 'critical', word: 'Unreachable', summary: 'The probe query failed. Messages cannot be stored.' };
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

/** The status strip, in reading order: server, database, engine, heap, host. */
export function healthCells(info: SystemInfo): readonly HealthCell[] {
  return [
    { key: 'server', label: 'Server', level: 'healthy', word: 'Running', summary: `v${info.server.version} · up ${formatUptime(info.server.uptime)}` },
    databaseCell(info.database),
    engineCell(info.engine),
    memoryCell(info.memory),
    hostCell(info),
  ];
}

/**
 * A plain-text snapshot for support tickets and chat. Facts only: no message
 * content, no settings values, no credentials.
 */
export function diagnosticsText(info: SystemInfo, now: Date): string {
  const { server, os, memory, engine, database } = info;
  const load = hasLoadAverage(info) ? os.loadAverage.map((n) => n.toFixed(2)).join(' / ') : 'n/a';
  return [
    `GalvaniFlow system information (${now.toISOString()})`,
    '',
    `Server     v${server.version} · ${server.env} · Node.js ${server.nodeVersion}`,
    `Process    pid ${server.pid} on ${server.hostname} · up ${formatUptime(server.uptime)} (since ${server.startedAt})`,
    `Database   ${database.connected ? `connected · PostgreSQL ${database.version ?? 'unknown'} · ${database.latencyMs ?? '?'} ms · ${database.sizeBytes === null ? 'size unknown' : formatBytes(database.sizeBytes)}` : 'UNREACHABLE'}`,
    `Engine     ${engine.deployed} deployed · ${engine.started} started · ${engine.paused} paused · ${engine.stopped} stopped`,
    `Memory     heap ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapLimit)} limit · rss ${formatBytes(memory.rss)} · external ${formatBytes(memory.external)}`,
    `Host       ${os.platform} ${os.release} ${os.arch} · ${os.cpus} CPUs · load ${load} · memory ${formatBytes(os.totalMemory - os.freeMemory)} / ${formatBytes(os.totalMemory)}`,
  ].join('\n');
}
