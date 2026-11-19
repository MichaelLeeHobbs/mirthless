import { useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';
import { formatTimestamp } from '../../lib/format.js';

interface KeyTokenDialogProps {
  readonly shown: { readonly name: string; readonly token: string; readonly oldSecretUntil: string | null } | null;
  readonly onClose: () => void;
}

export function KeyTokenDialog({ shown, onClose }: KeyTokenDialogProps): ReactNode {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyToken = (): void => {
    if (!shown) return;
    // No clipboard over plain HTTP to another host: say so, the field can still be copied by hand.
    if (navigator.clipboard === undefined) { setCopy('failed'); return; }
    navigator.clipboard.writeText(shown.token).then(() => { setCopy('copied'); }, () => { setCopy('failed'); });
  };
  const close = (): void => { setCopy('idle'); onClose(); };

  // Only Done closes it: a stray click or Escape would lose the token for good.
  return (
    <Dialog open={shown !== null} onClose={() => undefined} maxWidth="sm" fullWidth>
      <DialogTitle>Token for {shown?.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="warning">Copy it now. It is not shown again, and the server keeps only a hash of it.</Alert>
          <TextField
            label="Token" value={shown?.token ?? ''} fullWidth multiline
            slotProps={{ htmlInput: { readOnly: true, 'aria-label': 'Token' } }}
            sx={{ '& textarea': { fontFamily: FONT_FAMILY_MONO, fontSize: 13 } }}
          />
          <Typography variant="body2" color="text.secondary">
            Send it as <code>Authorization: Bearer &lt;token&gt;</code>. Never put it in a URL.
          </Typography>
          {copy === 'failed' && (
            <Alert severity="info">The browser would not copy it here. Select the token and copy it yourself.</Alert>
          )}
          {shown?.oldSecretUntil && (
            <Typography variant="body2" color="text.secondary">
              The old token keeps working until {formatTimestamp(shown.oldSecretUntil)}, so callers can switch.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<ContentCopyIcon />} onClick={copyToken}>{copy === 'copied' ? 'Copied' : 'Copy'}</Button>
        <Button variant="contained" onClick={close}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
