// ===========================================
// Message Detail Panel
// ===========================================
// Shows full message content with tabs for each content type.
// Connector sub-tabs when multiple connectors exist.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMessageDetail, useDeleteMessage, type ConnectorDetail } from '../../hooks/use-messages.js';
import { ContentViewer } from './ContentViewer.js';
import { AttachmentTab } from './AttachmentTab.js';

interface MessageDetailProps {
  readonly channelId: string;
  readonly messageId: number;
}

// Content keys displayed as tabs, in order
const CONTENT_TABS = [
  { key: 'raw', label: 'Raw' },
  { key: 'transformed', label: 'Transformed' },
  { key: 'sent', label: 'Sent' },
  { key: 'response', label: 'Response' },
  { key: 'error', label: 'Error' },
  { key: 'processingError', label: 'Processing Error' },
] as const;

// Map keys shown in expandable accordion
const MAP_KEYS = ['sourceMap', 'channelMap', 'connectorMap', 'responseMap'] as const;

function ConnectorContentTabs({ connector }: { readonly connector: ConnectorDetail }): ReactNode {
  const availableTabs = CONTENT_TABS.filter(t => connector.content[t.key] !== undefined);
  const [tabIndex, setTabIndex] = useState(0);

  if (availableTabs.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No content stored for this connector.
      </Typography>
    );
  }

  const activeTab = availableTabs[tabIndex] ?? availableTabs[0]!;
  const content = connector.content[activeTab.key] ?? '';

  return (
    <Box>
      <Tabs
        value={tabIndex < availableTabs.length ? tabIndex : 0}
        onChange={(_e, val: number) => setTabIndex(val)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}
      >
        {availableTabs.map((t) => (
          <Tab key={t.key} label={t.label} />
        ))}
      </Tabs>
      <ContentViewer content={content} />

      {/* Maps accordion */}
      {MAP_KEYS.some(k => connector.content[k] !== undefined) && (
        <Accordion disableGutters sx={{ mt: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2">Maps</Typography>
          </AccordionSummary>
          <AccordionDetails>
            {MAP_KEYS.filter(k => connector.content[k] !== undefined).map((k) => (
              <ContentViewer key={k} content={connector.content[k]!} label={k} />
            ))}
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}

export function MessageDetailPanel({ channelId, messageId }: MessageDetailProps): ReactNode {
  const { data: detail, isLoading, error } = useMessageDetail(channelId, messageId);
  const deleteMutation = useDeleteMessage();
  const [connectorTab, setConnectorTab] = useState(0);
  const [showAttachments, setShowAttachments] = useState(false);

  if (isLoading) {
    return (
      <Paper sx={{ p: 3, mt: 2, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper sx={{ p: 3, mt: 2 }}>
        <Typography color="error">Failed to load message: {error.message}</Typography>
      </Paper>
    );
  }

  if (!detail) return null;

  const connectors = detail.connectors;
  const activeConnector = connectors[connectorTab] ?? connectors[0];

  const handleDelete = (): void => {
    if (window.confirm(`Delete message ${String(messageId)}? This cannot be undone.`)) {
      deleteMutation.mutate({ channelId, messageId });
    }
  };

  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Message #{String(messageId)}
          </Typography>
          <Chip
            label={detail.processed ? 'Processed' : 'Pending'}
            size="small"
            color={detail.processed ? 'success' : 'warning'}
            variant="outlined"
          />
          <Typography variant="body2" color="text.secondary">
            {new Date(detail.receivedAt).toLocaleString()}
          </Typography>
        </Box>
        <Tooltip title="Delete message">
          <IconButton size="small" color="error" onClick={handleDelete} disabled={deleteMutation.isPending}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {connectors.length > 1 && (
        <Tabs
          value={connectorTab < connectors.length ? connectorTab : 0}
          onChange={(_e, val: number) => setConnectorTab(val)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 1, borderBottom: 1, borderColor: 'divider' }}
        >
          {connectors.map((c) => (
            <Tab
              key={c.metaDataId}
              label={c.connectorName ?? (c.metaDataId === 0 ? 'Source' : `Dest ${String(c.metaDataId)}`)}
            />
          ))}
        </Tabs>
      )}

      <Tabs
        value={showAttachments ? 1 : 0}
        onChange={(_e, val: number) => setShowAttachments(val === 1)}
        sx={{ mb: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Content" />
        <Tab label="Attachments" />
      </Tabs>

      {showAttachments ? (
        <AttachmentTab channelId={channelId} messageId={messageId} />
      ) : (
        activeConnector && (
          <Box>
            <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {activeConnector.connectorName ?? (activeConnector.metaDataId === 0 ? 'Source' : `Destination ${String(activeConnector.metaDataId)}`)}
              </Typography>
              <Chip label={activeConnector.status} size="small" variant="outlined" />
              {activeConnector.sendAttempts > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {String(activeConnector.sendAttempts)} attempt{activeConnector.sendAttempts !== 1 ? 's' : ''}
                </Typography>
              )}
            </Box>
            <ConnectorContentTabs connector={activeConnector} />
          </Box>
        )
      )}
    </Paper>
  );
}
