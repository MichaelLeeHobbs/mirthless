// ===========================================
// Event Detail Panel
// ===========================================
// Shows full event details including attributes as formatted JSON.

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import { useEvent } from '../../hooks/use-events.js';

interface EventDetailPanelProps {
  readonly eventId: number;
}

export function EventDetailPanel({ eventId }: EventDetailPanelProps): ReactNode {
  const { data: event, isLoading } = useEvent(eventId);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (!event) return null;

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', gap: 4, mb: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Server ID</Typography>
          <Typography variant="body2">{event.serverId ?? 'N/A'}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">IP Address</Typography>
          <Typography variant="body2">{event.ipAddress ?? 'N/A'}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">User ID</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
            {event.userId ?? 'N/A'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Channel ID</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
            {event.channelId ?? 'N/A'}
          </Typography>
        </Box>
      </Box>

      {event.attributes ? (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Attributes
          </Typography>
          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              bgcolor: 'action.hover',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              whiteSpace: 'pre-wrap',
              overflow: 'auto',
              maxHeight: 200,
            }}
          >
            {JSON.stringify(event.attributes, null, 2)}
          </Paper>
        </Box>
      ) : null}
    </Box>
  );
}
