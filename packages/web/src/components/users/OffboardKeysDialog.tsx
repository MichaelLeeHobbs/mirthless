// ===========================================
// Offboard Keys Dialog
// ===========================================
// Disabling a user who issued API keys (D-313): their keys are disabled with
// them, or keep working for 7 days for someone whose access covers them to
// replace. Only shown to holders of api_keys:manage, who may choose the wait;
// anyone else disables the user and their keys go with them.

import { useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import type { ApiKeyView, IssuedKeysOnLeave } from '@galvanigraph/core-models';

interface OffboardKeysDialogProps {
  /** The user being disabled and the live keys they issued; null when closed. */
  readonly target: { readonly username: string; readonly keys: readonly ApiKeyView[] } | null;
  readonly isPending: boolean;
  readonly onConfirm: (issuedKeys: IssuedKeysOnLeave) => void;
  readonly onCancel: () => void;
}

export function OffboardKeysDialog({ target, isPending, onConfirm, onCancel }: OffboardKeysDialogProps): ReactNode {
  const [choice, setChoice] = useState<IssuedKeysOnLeave>('disable');
  const names = target?.keys.map((k) => k.name).join(', ') ?? '';
  const count = target?.keys.length ?? 0;
  return (
    <Dialog open={target !== null} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Disable {target?.username}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {target?.username} will no longer be able to sign in. They issued {count === 1 ? 'an API key' : `${String(count)} API keys`}: {names}.
        </DialogContentText>
        <RadioGroup aria-label="What happens to their API keys" value={choice} onChange={(_e, value) => { setChoice(value as IssuedKeysOnLeave); }}>
          <FormControlLabel value="disable" control={<Radio />} label="Disable the keys now" />
          <FormControlLabel value="replace_within_7_days" control={<Radio />}
            label="Keep them working for 7 days, for someone to replace them on the API keys page" />
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" color="warning" disabled={isPending} onClick={() => { onConfirm(choice); }}>Disable</Button>
      </DialogActions>
    </Dialog>
  );
}
