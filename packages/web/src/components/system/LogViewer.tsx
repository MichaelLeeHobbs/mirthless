// ===========================================
// Log Viewer
// ===========================================
// Real-time server log viewer with filtering, search, and download.

import { useState, useEffect, useRef, useMemo, type ReactNode, type ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useHistoricalLogs, useLogStream, type LogEntry } from '../../hooks/use-logs.js';

// ----- Constants -----

const LEVELS = [
  { value: 20, label: 'DEBUG', color: 'text.disabled' },
  { value: 30, label: 'INFO', color: 'text.primary' },
  { value: 40, label: 'WARN', color: 'warning.main' },
  { value: 50, label: 'ERROR', color: 'error.main' },
] as const;

// ----- Helpers -----

function getLevelColor(level: number): string {
  if (level >= 50) return '#f44336'; // red
  if (level >= 40) return '#ff9800'; // orange
  if (level <= 20) return '#9e9e9e'; // gray
  return '#e0e0e0'; // default
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return iso;
  }
}

function formatLogLine(entry: LogEntry): string {
  return `[${formatTimestamp(entry.timestamp)}] ${entry.levelLabel.padEnd(5)} ${entry.message}`;
}

// ----- Component -----

export function LogViewer(): ReactNode {
  const [selectedLevels, setSelectedLevels] = useState<readonly number[]>([20, 30, 40, 50]);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Initial load
  const { data: historicalData } = useHistoricalLogs({ limit: 1000 });

  // Real-time stream
  const { entries: streamEntries, paused, setPaused, clear } = useLogStream();

  // Merge historical + streamed entries
  const allEntries = useMemo(() => {
    const historical = historicalData?.entries ?? [];
    // Stream entries are newest-first, historical are also newest-first
    // Deduplicate by combining and taking unique timestamps+messages
    const seen = new Set<string>();
    const combined: LogEntry[] = [];

    for (const entry of streamEntries) {
      const key = `${entry.timestamp}:${entry.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(entry);
      }
    }

    for (const entry of historical) {
      const key = `${entry.timestamp}:${entry.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(entry);
      }
    }

    return combined;
  }, [historicalData, streamEntries]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Apply client-side filters
  const filteredEntries = useMemo(() => {
    let result = allEntries;

    // Level filter
    if (selectedLevels.length < LEVELS.length) {
      const levelSet = new Set(selectedLevels);
      result = result.filter((e) => levelSet.has(e.level) || (e.level >= 50 && levelSet.has(50)));
    }

    // Search filter
    if (debouncedSearch) {
      const lower = debouncedSearch.toLowerCase();
      result = result.filter((e) => e.message.toLowerCase().includes(lower));
    }

    return result;
  }, [allEntries, selectedLevels, debouncedSearch]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!paused && logContainerRef.current) {
      logContainerRef.current.scrollTop = 0; // entries are newest-first, scroll to top
    }
  }, [filteredEntries, paused]);

  const handleLevelChange = (_e: React.MouseEvent<HTMLElement>, newLevels: number[]): void => {
    if (newLevels.length > 0) {
      setSelectedLevels(newLevels);
    }
  };

  const handleDownload = (): void => {
    const lines = filteredEntries.map(formatLogLine).join('\n');
    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `mirthless-logs-${timestamp}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Server Logs</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={paused ? 'Resume' : 'Pause'}>
            <IconButton size="small" onClick={() => setPaused(!paused)}>
              {paused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Download">
            <IconButton size="small" onClick={handleDownload}>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Clear">
            <IconButton size="small" onClick={clear}>
              <DeleteSweepIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          value={[...selectedLevels]}
          onChange={handleLevelChange}
          size="small"
        >
          {LEVELS.map((lvl) => (
            <ToggleButton key={lvl.value} value={lvl.value} sx={{ textTransform: 'none', px: 1.5 }}>
              {lvl.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <TextField
          placeholder="Search logs..."
          value={searchText}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
          size="small"
          sx={{ minWidth: 200 }}
        />

        <Typography variant="body2" color="text.secondary">
          {filteredEntries.length} entries
        </Typography>
      </Box>

      <Box
        ref={logContainerRef}
        sx={{
          height: 400,
          overflow: 'auto',
          bgcolor: '#1e1e1e',
          borderRadius: 1,
          p: 1,
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          lineHeight: 1.6,
        }}
      >
        {filteredEntries.map((entry, idx) => (
          <Box
            key={`${entry.timestamp}-${String(idx)}`}
            sx={{ color: getLevelColor(entry.level), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {formatLogLine(entry)}
          </Box>
        ))}
        {filteredEntries.length === 0 && (
          <Typography variant="body2" sx={{ color: '#666', textAlign: 'center', mt: 4 }}>
            No log entries
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
