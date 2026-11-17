// ===========================================
// Issue Key Dialog
// ===========================================
// The form for a new API key (D-313): name, permissions (never ones a key may
// not hold), every channel or chosen groups, a required end, and a reason when
// the key reads every channel's messages. The server checks the key is within
// what the issuer holds, now and until it ends, and says what is missing.

import { useState, type ChangeEvent, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { KEY_PERMISSIONS } from '@galvanigraph/core-models';
import { useChannelGroups } from '../../hooks/use-channel-groups.js';
import { permissionLabel } from '../../lib/channel-access.js';
import { draftProblem, needsReason, toIssueInput, type KeyDraft } from '../../lib/api-keys.js';
import type { CreateApiKeyInput } from '@galvanigraph/core-models';

interface IssueKeyDialogProps {
  readonly open: boolean;
  readonly saving: boolean;
  /** The server's refusal, shown as it said it. */
  readonly error: string | null;
  readonly onIssue: (input: CreateApiKeyInput) => void;
  readonly onClose: () => void;
}

const EMPTY: KeyDraft = { name: '', description: '', permissions: [], groupIds: null, expiresAt: '', reason: '' };
const ALL = 'all';
const GROUPS = 'groups';

export function IssueKeyDialog({ open, saving, error, onIssue, onClose }: IssueKeyDialogProps): ReactNode {
  const [draft, setDraft] = useState<KeyDraft>(EMPTY);
  const { data: groups = [] } = useChannelGroups();
  const problem = draftProblem(draft, Date.now());
  const close = (): void => { setDraft(EMPTY); onClose(); };
  const chosen = groups.filter((g) => (draft.groupIds ?? []).includes(g.id));

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>New API key</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" value={draft.name} required autoFocus
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setDraft({ ...draft, name: e.target.value }); }} />
          <TextField label="Description" value={draft.description}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setDraft({ ...draft, description: e.target.value }); }} />
          <Autocomplete
            multiple options={[...KEY_PERMISSIONS]} value={[...draft.permissions]}
            getOptionLabel={permissionLabel}
            onChange={(_e, next) => { setDraft({ ...draft, permissions: next }); }}
            renderInput={(params) => <TextField {...params} label="Permissions" helperText="Only what you hold yourself. Never users, roles, keys, the audit log or backups." />}
          />
          <TextField select label="Scope" value={draft.groupIds === null ? ALL : GROUPS}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setDraft({ ...draft, groupIds: e.target.value === ALL ? null : [] }); }}>
            <MenuItem value={ALL}>All channels</MenuItem>
            <MenuItem value={GROUPS}>Chosen groups</MenuItem>
          </TextField>
          {draft.groupIds !== null && (
            <Autocomplete
              multiple options={groups} value={chosen}
              getOptionLabel={(g) => g.name} isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_e, next) => { setDraft({ ...draft, groupIds: next.map((g) => g.id) }); }}
              renderInput={(params) => <TextField {...params} label="Groups" placeholder="Choose groups" />}
            />
          )}
          <TextField label="Ends" type="datetime-local" value={draft.expiresAt} required
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Every key ends. It cannot outlast your own access."
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setDraft({ ...draft, expiresAt: e.target.value }); }} />
          {needsReason(draft) && (
            <TextField label="Why it reads every channel's messages" value={draft.reason} required
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setDraft({ ...draft, reason: e.target.value }); }} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="contained" disabled={problem !== null || saving} title={problem ?? ''}
          // The form stays filled until the key is issued: a refusal is fixed here, not retyped.
          onClick={() => { onIssue(toIssueInput(draft)); }}>
          Issue key
        </Button>
      </DialogActions>
    </Dialog>
  );
}
