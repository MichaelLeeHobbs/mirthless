// ===========================================
// Revision History Dialog
// ===========================================
// Lists channel revisions and allows comparing two revisions.

import { useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Radio from '@mui/material/Radio';
import { useChannelRevisions } from '../../hooks/use-channel-revisions.js';
import { RevisionDiffView } from './RevisionDiffView.js';

interface Props {
  readonly channelId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function RevisionHistoryDialog({ channelId, open, onClose }: Props): ReactNode {
  const { data: revisions, isLoading } = useChannelRevisions(channelId);
  const [leftRev, setLeftRev] = useState<number>(0);
  const [rightRev, setRightRev] = useState<number>(0);
  const [comparing, setComparing] = useState(false);

  const handleCompare = (): void => {
    setComparing(true);
  };

  const handleBack = (): void => {
    setComparing(false);
  };

  const handleClose = (): void => {
    setComparing(false);
    setLeftRev(0);
    setRightRev(0);
    onClose();
  };

  if (comparing && leftRev > 0 && rightRev > 0) {
    return (
      <RevisionDiffView
        channelId={channelId}
        leftRev={Math.min(leftRev, rightRev)}
        rightRev={Math.max(leftRev, rightRev)}
        open={open}
        onBack={handleBack}
        onClose={handleClose}
      />
    );
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Revision History</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : !revisions || revisions.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No revisions found. Revisions are saved when a channel is updated.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">Left</TableCell>
                  <TableCell padding="checkbox">Right</TableCell>
                  <TableCell>Rev</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Comment</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {revisions.map((rev) => (
                  <TableRow key={rev.id}>
                    <TableCell padding="checkbox">
                      <Radio
                        size="small"
                        checked={leftRev === rev.revision}
                        onChange={() => { setLeftRev(rev.revision); }}
                      />
                    </TableCell>
                    <TableCell padding="checkbox">
                      <Radio
                        size="small"
                        checked={rightRev === rev.revision}
                        onChange={() => { setRightRev(rev.revision); }}
                      />
                    </TableCell>
                    <TableCell>{rev.revision}</TableCell>
                    <TableCell>{new Date(rev.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{rev.comment ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
        <Button
          variant="contained"
          disabled={leftRev === 0 || rightRev === 0 || leftRev === rightRev}
          onClick={handleCompare}
        >
          Compare
        </Button>
      </DialogActions>
    </Dialog>
  );
}
