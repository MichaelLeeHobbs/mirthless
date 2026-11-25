// D-322: a disabled user's working keys stop with them, since they know the
// secrets. Taking a key over gives it a new token instead.

import { useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ApiKeyView } from '@galvanigraph/core-models';
import { useChannelGroups } from '../../hooks/use-channel-groups.js';
import { keyScopeLabel } from '../../lib/api-keys.js';
import { groupNamer, permissionLabel } from '../../lib/channel-access.js';
import { formatTimestampWith } from '../../lib/format.js';

interface OffboardKeysDialogProps {
  readonly target: { readonly username: string; readonly keys: readonly ApiKeyView[] } | null;
  /** True when the signed-in user holds api_keys:manage and covers the key. */
  readonly canTakeOver: (key: ApiKeyView) => boolean;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly onConfirm: (takeOwnership: readonly string[]) => void;
  readonly onCancel: () => void;
}

interface LeaverKeysProps extends Pick<OffboardKeysDialogProps, 'canTakeOver'> {
  readonly keys: readonly ApiKeyView[];
  readonly taken: ReadonlySet<string>;
  readonly onToggle: (id: string, on: boolean) => void;
}

/** Mounted only while the dialog is open, so the Users page does not load groups to show users. */
function LeaverKeys({ keys, taken, canTakeOver, onToggle }: LeaverKeysProps): ReactNode {
  const { data: groups } = useChannelGroups();
  const groupName = groupNamer(groups);
  return keys.map((k) => (
    <Stack key={k.id} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{k.name}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{k.permissions.map(permissionLabel).join(', ')}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {`${keyScopeLabel(k.groupIds, groupName)}. ${formatTimestampWith(k.lastUsedAt, (at) => `Last used ${at.toLocaleString()}`, 'Never used')}`}
        </Typography>
      </Box>
      {canTakeOver(k) && (
        <FormControlLabel
          label="Take ownership"
          control={<Checkbox checked={taken.has(k.id)} onChange={(_e, on) => { onToggle(k.id, on); }}
            slotProps={{ input: { 'aria-label': `Take ownership of ${k.name}` } }} />}
        />
      )}
    </Stack>
  ));
}

export function OffboardKeysDialog({ target, canTakeOver, isPending, error, onConfirm, onCancel }: OffboardKeysDialogProps): ReactNode {
  // The page gives each user a fresh dialog, so nothing starts ticked.
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());
  const keys = target?.keys ?? [];
  const toggle = (id: string, on: boolean): void => {
    const next = new Set(taken);
    if (on) next.add(id); else next.delete(id);
    setTaken(next);
  };
  const stopping = keys.filter((k) => !taken.has(k.id)).length;

  return (
    <Dialog open={target !== null} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Disable {target?.username}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <DialogContentText>{target?.username} will no longer be able to sign in.</DialogContentText>
          <Alert severity="warning">
            {stopping === 0
              ? 'Every API key they issued is being taken over: each gets a new token, and the old one stops now.'
              : `${String(stopping)} API ${stopping === 1 ? 'key' : 'keys'} they issued will stop now. Each feed stops until it has a new token.`}
          </Alert>
          <LeaverKeys keys={keys} taken={taken} canTakeOver={canTakeOver} onToggle={toggle} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" color="warning" disabled={isPending} onClick={() => { onConfirm([...taken]); }}>Disable</Button>
      </DialogActions>
    </Dialog>
  );
}
