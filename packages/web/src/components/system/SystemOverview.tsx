// ===========================================
// System Overview
// ===========================================
// The System Information page's first tab: a status strip that answers "is
// anything wrong, and where" in one glance, then dense fact panels for the
// server process, database, memory and host.

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import { alpha, useTheme } from '@mui/material/styles';
import type { SystemInfo } from '../../hooks/use-system-info.js';
import { StatusChip } from '../common/StatusChip.js';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';
import {
  formatBytes, formatUptime, hasLoadAverage, healthCells, percentOf, usageLevel, type HealthCell,
} from '../../lib/system-health.js';

// ----- Status strip -----

/** Where a strip cell leads, when there is somewhere more useful to look. */
const CELL_LINK: Partial<Record<HealthCell['key'], string>> = { engine: '/' };

function StripCell({ cell }: { readonly cell: HealthCell }): ReactNode {
  const theme = useTheme();
  const accent = theme.palette.status[cell.level];
  const to = CELL_LINK[cell.key];
  return (
    <Paper
      {...(to ? { component: RouterLink, to } : {})}
      aria-label={`${cell.label}: ${cell.word}. ${cell.summary}`}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        px: 2,
        py: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        minWidth: 0,
        color: 'inherit',
        textDecoration: 'none',
        '&::before': { content: '""', position: 'absolute', insetInlineStart: 0, insetBlock: 0, width: 3, backgroundColor: accent },
        backgroundImage: `linear-gradient(90deg, ${alpha(accent, 0.06)}, transparent 60%)`,
        ...(to ? { '&:hover': { borderColor: accent } } : {}),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>{cell.label}</Typography>
        <StatusChip label={cell.word} level={cell.level} />
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }} title={cell.summary}>
        {cell.summary}
      </Typography>
    </Paper>
  );
}

function StatusStrip({ info }: { readonly info: SystemInfo }): ReactNode {
  return (
    <Box
      component="section"
      aria-label="System status"
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 1.5, mb: 2 }}
    >
      {healthCells(info).map((cell) => <StripCell key={cell.key} cell={cell} />)}
    </Box>
  );
}

// ----- Fact panels -----

function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <Paper component="section" aria-label={title} sx={{ p: 2.5 }}>
      <Typography variant="overline" component="h2" sx={{ display: 'block', color: 'text.secondary', mb: 1.25 }}>
        {title}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 3, rowGap: 1, alignItems: 'center' }}>
        {children}
      </Box>
    </Paper>
  );
}

/** A term/definition pair: label left, machine value right in mono. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <>
      <Typography component="dt" variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography
        component="dd"
        variant="body2"
        sx={{ m: 0, justifySelf: 'end', textAlign: 'right', fontFamily: FONT_FAMILY_MONO, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}
      >
        {children}
      </Typography>
    </>
  );
}

/** A usage bar spanning both columns, coloured by the same thresholds as the strip. */
function UsageBar({ label, used, total }: { readonly label: string; readonly used: number; readonly total: number }): ReactNode {
  const theme = useTheme();
  const percent = percentOf(used, total);
  const color = theme.palette.status[usageLevel(percent)];
  return (
    <Box sx={{ gridColumn: '1 / -1', mb: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 0.5 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
        <Typography variant="body2" sx={{ fontFamily: FONT_FAMILY_MONO, fontVariantNumeric: 'tabular-nums' }}>
          {formatBytes(used)} / {formatBytes(total)} ({percent.toFixed(1)}%)
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={percent}
        aria-label={`${label} ${percent.toFixed(0)}% used`}
        sx={{ height: 6, borderRadius: 1, backgroundColor: alpha(color, 0.16), '& .MuiLinearProgress-bar': { backgroundColor: color } }}
      />
    </Box>
  );
}

function ServerPanel({ server }: { readonly server: SystemInfo['server'] }): ReactNode {
  return (
    <Panel title="Server">
      <Fact label="Version">{server.version}</Fact>
      <Fact label="Environment">{server.env}</Fact>
      <Fact label="Node.js">{server.nodeVersion}</Fact>
      <Fact label="Hostname">{server.hostname}</Fact>
      <Fact label="PID">{server.pid}</Fact>
      <Fact label="Started">{new Date(server.startedAt).toLocaleString()}</Fact>
      <Fact label="Uptime">{formatUptime(server.uptime)}</Fact>
    </Panel>
  );
}

function DatabasePanel({ database }: { readonly database: SystemInfo['database'] }): ReactNode {
  return (
    <Panel title="Database">
      <Fact label="PostgreSQL">{database.version ?? '—'}</Fact>
      <Fact label="Round trip">{database.latencyMs === null ? '—' : `${database.latencyMs} ms`}</Fact>
      <Fact label="Size on disk">{database.sizeBytes === null ? '—' : formatBytes(database.sizeBytes)}</Fact>
    </Panel>
  );
}

function MemoryPanel({ memory }: { readonly memory: SystemInfo['memory'] }): ReactNode {
  return (
    <Panel title="Process memory">
      <UsageBar label="Heap used of limit" used={memory.heapUsed} total={memory.heapLimit} />
      <Fact label="Heap allocated">{formatBytes(memory.heapTotal)}</Fact>
      <Fact label="Resident (RSS)">{formatBytes(memory.rss)}</Fact>
      <Fact label="External">{formatBytes(memory.external)}</Fact>
    </Panel>
  );
}

function HostPanel({ info }: { readonly info: SystemInfo }): ReactNode {
  const { os } = info;
  return (
    <Panel title="Host">
      <UsageBar label="System memory" used={os.totalMemory - os.freeMemory} total={os.totalMemory} />
      <Fact label="Platform">{`${os.platform} ${os.release}`}</Fact>
      <Fact label="Architecture">{os.arch}</Fact>
      <Fact label="CPUs">{os.cpus}</Fact>
      <Fact label="Load (1 / 5 / 15 min)">
        {hasLoadAverage(info) ? os.loadAverage.map((n) => n.toFixed(2)).join(' / ') : 'n/a on Windows'}
      </Fact>
    </Panel>
  );
}

// ----- Overview -----

export function SystemOverview({ info }: { readonly info: SystemInfo }): ReactNode {
  return (
    <Box>
      <StatusStrip info={info} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2, alignItems: 'start' }}>
        <ServerPanel server={info.server} />
        <DatabasePanel database={info.database} />
        <MemoryPanel memory={info.memory} />
        <HostPanel info={info} />
      </Box>
    </Box>
  );
}
