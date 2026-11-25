// A clone (?from=<id>) saves with clonedFrom, which the audit log records.

import { useEffect, useRef, useState, type ReactNode, type ChangeEvent } from 'react';
import { Link as RouterLink, useBlocker, useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { PERMISSIONS, type Permission } from '@galvanigraph/core-models';
import { useRoles, useCreateRole, useUpdateRole } from '../hooks/use-roles.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { useAddressId, useAddressQueryId } from '../hooks/use-address-id.js';
import { useBeforeUnload } from '../hooks/use-beforeunload.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { UnsavedChangesBar } from '../components/common/UnsavedChangesBar.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { LoadingBlock } from '../components/common/states/LoadingState.js';
import { PermissionPicker } from '../components/users/PermissionPicker.js';
import type { RoleSummary } from '../api/client.js';

interface Draft {
  readonly name: string;
  readonly description: string;
  readonly permissions: ReadonlySet<string>;
}

const EMPTY: Draft = { name: '', description: '', permissions: new Set() };

function draftOf(role: RoleSummary | undefined, clone: boolean): Draft {
  if (!role) return EMPTY;
  // The admin role holds every permission, whatever list it carries.
  const permissions = role.admin ? Object.values(PERMISSIONS) : role.permissions;
  return { name: clone ? `Copy of ${role.name}` : role.name, description: role.description, permissions: new Set(permissions) };
}

function changeCount(a: Draft, b: Draft): number {
  const samePerms = a.permissions.size === b.permissions.size && [...a.permissions].every((p) => b.permissions.has(p));
  return Number(a.name !== b.name) + Number(a.description !== b.description) + Number(!samePerms);
}

export function RoleEditorPage(): ReactNode {
  const id = useAddressId();
  const fromId = useAddressQueryId('from');
  const navigate = useNavigate();
  const { data: roles, isLoading, error, refetch } = useRoles();
  const { permissions: held } = usePermissions();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  const editing = roles?.find((r) => r.id === id);
  const source = roles?.find((r) => r.id === fromId);
  // Seeded once per role: a background refetch (a new holder count, another
  // tab) must not reset what is typed.
  const key = `${id ?? ''}|${fromId ?? ''}`;
  const [seed, setSeed] = useState<{ readonly key: string; readonly draft: Draft } | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (!roles || seed?.key === key) return;
    const taken = id ? draftOf(editing, false) : draftOf(source, true);
    setSeed({ key, draft: taken });
    setDraft(taken);
  }, [roles, key, seed, id, editing, source]);
  const initial = seed?.draft ?? EMPTY;
  const seeded = seed?.key === key;

  const locked = editing?.admin === true;
  const isNew = id === undefined;
  const saving = createRole.isPending || updateRole.isPending;
  // A new role, a clone included, is unsaved until it is saved.
  const changes = locked ? 0 : isNew ? 1 : changeCount(draft, initial);
  const dirty = !locked && changeCount(draft, initial) > 0;
  const saved = useRef(false);
  const blocker = useBlocker(() => dirty && !saving && !saved.current);
  useBeforeUnload(dirty && !saving);

  const toggle = (p: Permission): void => {
    const next = new Set(draft.permissions);
    if (next.has(p)) next.delete(p); else next.add(p);
    setDraft({ ...draft, permissions: next });
  };

  const save = (): void => {
    setSaveError(null);
    const permissions = [...draft.permissions] as Permission[];
    const onError = (err: Error): void => { setSaveError(err.message); };
    const done = (): void => { saved.current = true; void navigate('/roles'); };
    if (id) {
      updateRole.mutate({ id, input: { name: draft.name, description: draft.description, permissions } }, { onSuccess: done, onError });
    } else {
      createRole.mutate({ name: draft.name, description: draft.description, permissions, ...(source ? { clonedFrom: source.id } : {}) }, { onSuccess: done, onError });
    }
  };

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorState title="Roles couldn't load" error={error} onRetry={() => void refetch()} />;
  const missing = id ? !editing : fromId !== null && !source;
  if (missing) {
    return (
      <Box>
        <PageHeader title="Role not found" description="The role may have been deleted, or your access changed." />
        <Alert severity="warning" action={<Button component={RouterLink} to="/roles" color="inherit" size="small">Back to roles</Button>}>
          {id ? 'There is no role to edit at this address.' : 'There is no role to clone at this address.'}
        </Alert>
      </Box>
    );
  }
  if (!seeded) return <LoadingBlock />;

  const title = id ? `Edit role: ${editing?.name ?? ''}` : source ? `Clone role: ${source.name}` : 'New role';
  return (
    <Box sx={{ pb: 10 }}>
      <PageHeader title={title} description="Choose what holders of this role may do. You can add only permissions you hold yourself." />
      {locked && <Alert severity="info" sx={{ mb: 2 }}>The admin role is locked. It holds every permission and cannot be changed.</Alert>}
      {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack spacing={2}>
          <TextField label="Name" value={draft.name} required disabled={locked}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setDraft({ ...draft, name: e.target.value }); }} />
          <TextField label="Description" value={draft.description} disabled={locked} multiline minRows={2}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setDraft({ ...draft, description: e.target.value }); }} />
        </Stack>
      </Paper>
      <PermissionPicker selected={draft.permissions} held={held} original={initial.permissions} readOnly={locked} onToggle={toggle} />
      {changes > 0 && (
        <UnsavedChangesBar count={changes} saving={saving}
          blockedReason={draft.name.trim().length === 0 ? 'Give the role a name' : null}
          onDiscard={() => { setDraft(initial); if (isNew) { saved.current = true; void navigate('/roles'); } }} onSave={save} />
      )}
      <Dialog open={blocker.state === 'blocked'}>
        <DialogTitle>Leave without saving?</DialogTitle>
        <DialogContent>The changes to this role are not saved.</DialogContent>
        <DialogActions>
          <Button onClick={() => { blocker.reset?.(); }}>Stay</Button>
          <Button color="error" onClick={() => { blocker.proceed?.(); }}>Leave</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
