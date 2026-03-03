// ===========================================
// Attachment Tab
// ===========================================
// Shows attachment list for a message with download/view support.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useAttachments, useAttachment } from '../../hooks/use-attachments.js';
import { ContentViewer } from './ContentViewer.js';

interface AttachmentTabProps {
  readonly channelId: string;
  readonly messageId: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]!}`;
}

function AttachmentPreview({ channelId, messageId, attachmentId }: {
  readonly channelId: string;
  readonly messageId: number;
  readonly attachmentId: string;
}): ReactNode {
  const { data, isLoading } = useAttachment(channelId, messageId, attachmentId);

  if (isLoading) return <CircularProgress size={16} />;
  if (!data) return null;

  return <ContentViewer content={data.content} />;
}

export function AttachmentTab({ channelId, messageId }: AttachmentTabProps): ReactNode {
  const { data: attachments, isLoading, error } = useAttachments(channelId, messageId);
  const [previewId, setPreviewId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return <Typography color="error">Failed to load attachments: {error.message}</Typography>;
  }

  if (!attachments || attachments.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No attachments for this message.
      </Typography>
    );
  }

  return (
    <Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>MIME Type</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Encrypted</TableCell>
              <TableCell width={48} />
            </TableRow>
          </TableHead>
          <TableBody>
            {attachments.map((att) => (
              <TableRow key={`${att.id}-${String(att.segmentId)}`} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {att.id}
                  </Typography>
                </TableCell>
                <TableCell>{att.mimeType ?? 'unknown'}</TableCell>
                <TableCell align="right">{formatBytes(att.attachmentSize)}</TableCell>
                <TableCell>
                  {att.isEncrypted && <Chip label="Encrypted" size="small" color="warning" variant="outlined" />}
                </TableCell>
                <TableCell>
                  <Tooltip title="Preview">
                    <IconButton
                      size="small"
                      onClick={() => setPreviewId(previewId === att.id ? null : att.id)}
                    >
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {previewId && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Attachment Preview: {previewId}</Typography>
          <AttachmentPreview channelId={channelId} messageId={messageId} attachmentId={previewId} />
        </Box>
      )}
    </Box>
  );
}
