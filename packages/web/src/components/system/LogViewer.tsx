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
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';
import { formatTimestampWith } from '../../lib/format.js';
import { saveFile } from '../../lib/download.js';

const LEVELS = [
  { value: 20, label: 'DEBUG', color: 'text.disabled' },
  { value: 30, label: 'INFO', color: 'text.primary' },
  { value: 40, label: 'WARN', color: 'warning.main' },
  { value: 50, label: 'ERROR', color: 'error.main' },
] as const;

function getLevelColor(level: number): string {
  if (level >= 50) return 'status.critical';
  if (level >= 40) return 'status.warning';
  if (level <= 20) return 'text.disabled';
  return 'text.primary';
}

function clockTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function formatClockTime(iso: string | null | undefined): string {
  return formatTimestampWith(iso, clockTime);
}

function formatLogLine(entry: LogEntry): string {
  return `[${formatClockTime(entry.timestamp)}] ${entry.levelLabel.padEnd(5)} ${entry.message}`;
}

export function LogViewer(): ReactNode {
  const [selectedLevels, setSelectedLevels] = useState<readonly number[]>([20, 30, 40, 50]);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const logContainerRef = useRef<HTMLDivElement>(null);

  const { data: historicalData } = useHistoricalLogs({ limit: 1000 });

  const { entries: streamEntries, paused, setPaused, clear } = useLogStream();

  const allEntries = useMemo(() => {
    const historical = historicalData?.entries ?? [];
    // Both lists are newest-first, and the stream holds the newer lines.
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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const filteredEntries = useMemo(() => {
    let result = allEntries;

    if (selectedLevels.length < LEVELS.length) {
      const levelSet = new Set(selectedLevels);
      result = result.filter((e) => levelSet.has(e.level) || (e.level >= 50 && levelSet.has(50)));
    }

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
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveFile(`galvanigraph-logs-${timestamp}.log`, filteredEntries.map(formatLogLine).join('\n'), 'text/plain');
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

        <Typography variant="body2" sx={{
          color: 'text.secondary'
        }}>
          {filteredEntries.length} entries
        </Typography>
      </Box>

      <Box
        ref={logContainerRef}
        sx={{
          height: 400,
          overflow: 'auto',
          bgcolor: 'surfaceSunken',
          borderRadius: 1,
          p: 1,
          fontFamily: FONT_FAMILY_MONO,
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
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: 4 }}>
            No log entries
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
