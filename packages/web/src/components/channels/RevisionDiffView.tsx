// ===========================================
// Revision Diff View
// ===========================================
// Monaco DiffEditor showing JSON diff between two revisions.

import { type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { DiffEditor } from '@monaco-editor/react';
import { useChannelRevision } from '../../hooks/use-channel-revisions.js';
import { useUiStore } from '../../stores/ui.store.js';

interface Props {
  readonly channelId: string;
  readonly leftRev: number;
  readonly rightRev: number;
  readonly open: boolean;
  readonly onBack: () => void;
  readonly onClose: () => void;
}

export function RevisionDiffView({ channelId, leftRev, rightRev, open, onBack, onClose }: Props): ReactNode {
  const { data: leftData, isLoading: leftLoading } = useChannelRevision(channelId, leftRev);
  const { data: rightData, isLoading: rightLoading } = useChannelRevision(channelId, rightRev);
  const themeMode = useUiStore((state) => state.themeMode);

  const isLoading = leftLoading || rightLoading;

  const leftText = leftData ? JSON.stringify(leftData.snapshot, null, 2) : '';
  const rightText = rightData ? JSON.stringify(rightData.snapshot, null, 2) : '';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>
        Compare Revisions: {String(leftRev)} vs {String(rightRev)}
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ height: '70vh' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'action.hover' }}>
              <Typography variant="body2" color="text.secondary">
                Revision {String(leftRev)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Revision {String(rightRev)}
              </Typography>
            </Box>
            <DiffEditor
              height="calc(70vh - 40px)"
              language="json"
              original={leftText}
              modified={rightText}
              theme={themeMode === 'dark' ? 'vs-dark' : 'light'}
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
              }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onBack}>Back</Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
