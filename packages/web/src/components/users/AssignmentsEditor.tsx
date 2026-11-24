// D-310. The Default group is never offered as a scope: every new channel may join it.

import type { ReactNode, ChangeEvent } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { DEFAULT_GROUP_NAME } from '@galvanigraph/core-models';
import { useRoles } from '../../hooks/use-roles.js';
import { useChannelGroups, type ChannelGroupSummary } from '../../hooks/use-channel-groups.js';
import { groupScopeBlocked, type AssignmentDraft } from '../../lib/assignments.js';
import { humanize } from '../../lib/format.js';
import { assignmentLevel } from '../../lib/status.js';
import { StatusChip } from '../common/StatusChip.js';
import { LoadingBlock } from '../common/states/LoadingState.js';
import type { RoleSummary } from '../../api/client.js';

interface AssignmentsEditorProps {
  readonly value: readonly AssignmentDraft[];
  readonly onChange: (value: readonly AssignmentDraft[]) => void;
}

const ALL = 'all';
const GROUPS = 'groups';

function roleLabel(r: RoleSummary): string {
  return r.builtIn ? humanize(r.name) : r.name;
}

interface RowProps {
  readonly draft: AssignmentDraft;
  readonly roles: readonly RoleSummary[];
  readonly groups: readonly ChannelGroupSummary[];
  readonly onChange: (draft: AssignmentDraft) => void;
  readonly onRemove: () => void;
}

function AssignmentRow({ draft, roles, groups, onChange, onRemove }: RowProps): ReactNode {
  const scoped = draft.groupIds !== null;
  const role = roles.find((r) => r.id === draft.roleId);
  const blocked = role ? groupScopeBlocked(role.permissions) : null;
  const chosen = groups.filter((g) => draft.groupIds?.includes(g.id) === true);
  // Groups the list does not show (still loading, or not visible to the editor) stay in the scope.
  const unseen = (draft.groupIds ?? []).filter((id) => !groups.some((g) => g.id === id));
  const name = role ? roleLabel(role) : 'this role';
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
        <TextField
          select label="Role" size="small" value={draft.roleId} sx={{ minWidth: 180 }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ ...draft, roleId: e.target.value }); }}
        >
          {roles.filter((r) => !r.admin || !scoped).map((r) => {
            const why = scoped ? groupScopeBlocked(r.permissions) : null;
            return <MenuItem key={r.id} value={r.id} disabled={why !== null}>{roleLabel(r)}{why ? ` (${why})` : ''}</MenuItem>;
          })}
        </TextField>
        <TextField
          select label="Scope" size="small" value={scoped ? GROUPS : ALL} sx={{ minWidth: 150 }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ ...draft, groupIds: e.target.value === ALL ? null : [] }); }}
        >
          <MenuItem value={ALL}>All channels</MenuItem>
          <MenuItem value={GROUPS} disabled={blocked !== null}>Chosen groups{blocked ? ` (${blocked})` : ''}</MenuItem>
        </TextField>
        <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />
        <Tooltip title={`Remove ${name}`}>
          <IconButton aria-label={`Remove ${name}`} onClick={onRemove} size="small" sx={{ alignSelf: { xs: 'flex-end', sm: 'flex-start' } }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {scoped && (
        <Autocomplete
          multiple size="small" sx={{ mt: 1 }}
          options={groups}
          value={chosen}
          getOptionLabel={(g) => g.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_e, next) => { onChange({ ...draft, groupIds: [...unseen, ...next.map((g) => g.id)] }); }}
          renderInput={(params) => {
            const empty = (draft.groupIds ?? []).length === 0;
            const helper = empty ? 'Choose at least one group' : unseen.length > 0 ? `Also ${String(unseen.length)} group(s) not listed here` : undefined;
            return <TextField {...params} label="Groups" placeholder="Choose groups" error={empty} helperText={helper} />;
          }}
        />
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: { sm: 'flex-start' } }}>
        <TextField
          label="Until" type="datetime-local" size="small" value={draft.expiresAt}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1 } }}
          helperText={draft.expiresAt === '' ? 'Permanent' : undefined}
          // A new end time renews an expired row.
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ ...draft, expiresAt: e.target.value, expired: false }); }}
        />
        <TextField
          label="Reason" size="small" value={draft.reason} sx={{ flex: 1 }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ ...draft, reason: e.target.value }); }}
        />
        {draft.expired && <StatusChip label="Expired" level={assignmentLevel(true)} />}
      </Stack>
      {draft.expired && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          It grants nothing now. Saving removes it unless you set a new end time.
        </Typography>
      )}
    </Box>
  );
}

/** A counter, since crypto.randomUUID needs HTTPS. */
let nextRowKey = 0;

/** A new row: the first role, on every channel, permanent. */
function newDraft(roles: readonly RoleSummary[]): AssignmentDraft {
  const first = roles.find((r) => !r.admin) ?? roles[0];
  nextRowKey += 1;
  return { key: `new-${String(nextRowKey)}`, roleId: first?.id ?? '', groupIds: null, expiresAt: '', savedExpiresAt: null, reason: '', expired: false };
}

export function AssignmentsEditor({ value, onChange }: AssignmentsEditorProps): ReactNode {
  const { data: roles, isError: rolesFailed } = useRoles(true);
  const { data: groups } = useChannelGroups();
  const scopeGroups = (groups ?? []).filter((g) => g.name !== DEFAULT_GROUP_NAME);
  const replace = (i: number, next: AssignmentDraft): void => { onChange(value.map((d, j) => (j === i ? next : d))); };

  if (rolesFailed) return <Alert severity="error">The roles could not load (reading them needs the Read roles permission), so access cannot be changed here.</Alert>;
  if (!roles) return <LoadingBlock label="Loading roles" py={2} />;
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>Access</Typography>
      <Stack spacing={1}>
        {value.length === 0 && <Typography variant="body2" color="text.secondary">No access. This user can sign in but sees nothing.</Typography>}
        {value.map((d, i) => (
          <AssignmentRow
            key={d.key} draft={d} roles={roles} groups={scopeGroups}
            onChange={(next) => { replace(i, next); }}
            onRemove={() => { onChange(value.filter((_d, j) => j !== i)); }}
          />
        ))}
      </Stack>
      <Button startIcon={<AddIcon />} size="small" sx={{ mt: 1 }} onClick={() => { onChange([...value, newDraft(roles)]); }}>
        Add access
      </Button>
    </Box>
  );
}
