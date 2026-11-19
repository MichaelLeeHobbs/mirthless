import { type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import { useChannelRevision } from '../../hooks/use-channel-revisions.js';
import { CodeDiffEditor } from '../editors/CodeDiffEditor.js';

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

  const isLoading = leftLoading || rightLoading;

  const leftText = leftData ? JSON.stringify(leftData.snapshot, null, 2) : '';
  const rightText = rightData ? JSON.stringify(rightData.snapshot, null, 2) : '';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>
        Compare Revisions: {String(leftRev)} vs {String(rightRev)}
      </DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <CodeDiffEditor
            label={`Revision ${String(leftRev)} compared with revision ${String(rightRev)}`}
            originalLabel={`Revision ${String(leftRev)}`}
            modifiedLabel={`Revision ${String(rightRev)}`}
            original={leftText}
            modified={rightText}
            height="62vh"
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onBack}>Back</Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
