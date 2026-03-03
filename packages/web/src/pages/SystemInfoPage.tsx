// ===========================================
// System Info Page
// ===========================================
// Displays server info, memory usage, DB status, engine stats, OS info.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import LinearProgress from '@mui/material/LinearProgress';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useSystemInfo } from '../hooks/use-system-info.js';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

interface MemoryBarProps {
  readonly label: string;
  readonly used: number;
  readonly total: number;
}

function MemoryBar({ label, used, total }: MemoryBarProps): ReactNode {
  const percent = total > 0 ? (used / total) * 100 : 0;
  const color = percent > 90 ? 'error' : percent > 70 ? 'warning' : 'primary';

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {formatBytes(used)} / {formatBytes(total)} ({percent.toFixed(1)}%)
        </Typography>
      </Box>
      <LinearProgress variant="determinate" value={percent} color={color} sx={{ height: 8, borderRadius: 1 }} />
    </Box>
  );
}

interface InfoRowProps {
  readonly label: string;
  readonly value: string | number;
}

function InfoRow({ label, value }: InfoRowProps): ReactNode {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{value}</Typography>
    </Box>
  );
}

export function SystemInfoPage(): ReactNode {
  const { data: info, isLoading, error } = useSystemInfo();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600, mb: 3 }}>
        System Information
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load system info: {error.message}
        </Alert>
      )}

      {info && (
        <Grid container spacing={3}>
          {/* Server Info */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Server</Typography>
              <InfoRow label="Version" value={info.server.version} />
              <InfoRow label="Node.js" value={info.server.nodeVersion} />
              <InfoRow label="Environment" value={info.server.env} />
              <InfoRow label="PID" value={info.server.pid} />
              <InfoRow label="Uptime" value={formatUptime(info.server.uptime)} />
            </Paper>
          </Grid>

          {/* Database Status */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Database</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">Status:</Typography>
                <Chip
                  label={info.database.connected ? 'Connected' : 'Disconnected'}
                  size="small"
                  color={info.database.connected ? 'success' : 'error'}
                />
              </Box>
            </Paper>
          </Grid>

          {/* Process Memory */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Process Memory</Typography>
              <MemoryBar label="Heap" used={info.memory.heapUsed} total={info.memory.heapTotal} />
              <InfoRow label="RSS" value={formatBytes(info.memory.rss)} />
              <InfoRow label="External" value={formatBytes(info.memory.external)} />
            </Paper>
          </Grid>

          {/* OS Memory */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Operating System</Typography>
              <MemoryBar
                label="System Memory"
                used={info.os.totalMemory - info.os.freeMemory}
                total={info.os.totalMemory}
              />
              <InfoRow label="Platform" value={info.os.platform} />
              <InfoRow label="Architecture" value={info.os.arch} />
            </Paper>
          </Grid>

          {/* Engine Stats */}
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Engine</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <Typography variant="h4" sx={{ fontWeight: 600, textAlign: 'center' }}>
                    {info.engine.deployed}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    Deployed
                  </Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="h4" sx={{ fontWeight: 600, textAlign: 'center', color: 'success.main' }}>
                    {info.engine.started}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    Started
                  </Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="h4" sx={{ fontWeight: 600, textAlign: 'center', color: 'error.main' }}>
                    {info.engine.stopped}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    Stopped
                  </Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="h4" sx={{ fontWeight: 600, textAlign: 'center', color: 'warning.main' }}>
                    {info.engine.paused}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    Paused
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
