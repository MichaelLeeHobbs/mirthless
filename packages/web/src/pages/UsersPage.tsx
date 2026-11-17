// ===========================================
// Users Page
// ===========================================
// User management: list, create, edit, toggle enabled, unlock.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Switch from '@mui/material/Switch';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PeopleIcon from '@mui/icons-material/People';
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser, useChangePassword, useUnlockUser } from '../hooks/use-users.js';
import { useApiKeys } from '../hooks/use-api-keys.js';
import { coversKey, liveKeysIssuedBy } from '../lib/api-keys.js';
import { OffboardKeysDialog } from '../components/users/OffboardKeysDialog.js';
import { KeyTokenDialog } from '../components/api-keys/KeyTokenDialog.js';
import { useAuthStore } from '../stores/auth.store.js';
import type { TakenOverKey } from '@galvanigraph/core-models';
import { UserDialog, type UserFormData } from '../components/users/UserDialog.js';
import { useSetAssignments } from '../hooks/use-assignments.js';
import { toSend } from '../lib/assignments.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { formatTimestamp, humanize } from '../lib/format.js';
import { errorMessage } from '../lib/error-message.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';
import type { UserSummary } from '../api/client.js';

/** The fields of an edited user that differ from the stored ones, as an update request. */
function changedFields(user: UserSummary, data: UserFormData): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (data.email !== user.email) input['email'] = data.email;
  if (data.firstName !== (user.firstName ?? '')) input['firstName'] = data.firstName || null;
  if (data.lastName !== (user.lastName ?? '')) input['lastName'] = data.lastName || null;
  // An existing user's access changes through their assignments, never the single role.
  return input;
}

export function UsersPage(): ReactNode {
  const { data: users, isLoading, error, isFetching, refetch } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const changePassword = useChangePassword();
  const unlockUser = useUnlockUser();
  const setAssignments = useSetAssignments();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<UserSummary | null>(null);
  const { has } = usePermissions();
  const canWrite = has(PERMISSION.USERS_WRITE);
  const canDelete = has(PERMISSION.USERS_DELETE);
  // Reading the keys needs api_keys:read; choosing their fate needs api_keys:manage.
  // Reading the keys a leaver issued needs api_keys:read; taking one over needs api_keys:manage too.
  const canReadKeys = has(PERMISSION.API_KEYS_READ);
  const canManageKeys = has(PERMISSION.API_KEYS_MANAGE) && canReadKeys;
  const { data: keys } = useApiKeys(canReadKeys);
  const grants = useAuthStore((s) => s.user?.grants);
  // The tokens of keys taken over, shown one at a time, once.
  const [newTokens, setNewTokens] = useState<readonly TakenOverKey[]>([]);
  const [offboardError, setOffboardError] = useState<string | null>(null);

  const handleOpenCreate = (): void => {
    setEditingUser(null);
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (user: UserSummary): void => {
    setEditingUser(user);
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleClose = (): void => {
    setDialogOpen(false);
    setEditingUser(null);
    setDialogError(null);
  };

  /**
   * Save the edited details, then the new password, and close only when both
   * worked. A refused password keeps the dialog open with the server's reason:
   * an admin resetting a leaked password must know it did not change (#222).
   */
  const saveEdit = async (user: UserSummary, data: UserFormData): Promise<void> => {
    const input = changedFields(user, data);
    const hasUpdates = Object.keys(input).length > 0;
    try {
      // The saved user becomes what the dialog edits, so a retry after a refused
      // password does not send (and audit) the same details again.
      if (hasUpdates) setEditingUser(await updateUser.mutateAsync({ id: user.id, input }));
    } catch (err) {
      setDialogError(errorMessage(err, 'The user could not be saved.'));
      return;
    }
    try {
      // Any typed password goes to the server, which applies the password policy.
      if (data.password.length > 0) await changePassword.mutateAsync({ id: user.id, newPassword: data.password });
    } catch (err) {
      const reason = errorMessage(err, 'The password could not be changed.');
      setDialogError(hasUpdates ? `The details were saved, but the password was not changed: ${reason}` : reason);
      return;
    }
    try {
      // The server judges the whole list; a refusal names what the editor lacks.
      if (data.assignments !== null) await setAssignments.mutateAsync({ id: user.id, assignments: toSend(data.assignments) });
    } catch (err) {
      const reason = errorMessage(err, 'The access could not be changed.');
      setDialogError(hasUpdates || data.password.length > 0 ? `The other changes were saved, but the access was not: ${reason}` : reason);
      return;
    }
    handleClose();
  };

  const handleSave = (data: UserFormData): void => {
    if (editingUser) {
      void saveEdit(editingUser, data);
    } else {
      // Create new user
      createUser.mutate({
        username: data.username,
        email: data.email,
        password: data.password,
        firstName: data.firstName || null,
        lastName: data.lastName || null,
        role: data.role,
      }, {
        onSuccess: () => { handleClose(); },
        onError: (err) => { setDialogError(err.message); },
      });
    }
  };

  /** Why the enabled switch is locked for this user, or '' when it can be used. Disabling needs users:delete. */
  const toggleBlockedReason = (user: UserSummary): string => {
    if (user.enabled) return canDelete ? '' : 'Requires users:delete permission';
    return canWrite ? '' : 'Requires users:write permission';
  };

  const handleToggleEnabled = (user: UserSummary): void => {
    if (user.enabled) {
      // Disabling is destructive — confirm first.
      setDisableTarget(user);
    } else {
      updateUser.mutate({ id: user.id, input: { enabled: true } });
    }
  };

  const handleConfirmDisable = (): void => {
    if (!disableTarget) return;
    deleteUser.mutate({ id: disableTarget.id });
    setDisableTarget(null);
  };
  // The working keys the user being disabled issued: they stop with them (D-322), so the dialog says so first.
  const targetKeys = disableTarget && keys ? liveKeysIssuedBy(keys, disableTarget.id) : [];
  const offboarding = targetKeys.length > 0;
  const handleConfirmOffboard = (takeOwnership: readonly string[]): void => {
    if (!disableTarget) return;
    deleteUser.mutate({ id: disableTarget.id, takeOwnership }, {
      // Kept open on a refusal (such as a key the admin cannot keep until it ends): nothing changed.
      onSuccess: (taken) => { setDisableTarget(null); setOffboardError(null); setNewTokens(taken); deleteUser.reset(); },
      onError: (err) => { setOffboardError(err.message); },
    });
  };

  const handleUnlock = (user: UserSummary): void => {
    unlockUser.mutate(user.id);
  };

  return (
    <Box>
      <PageHeader
        title="Users"
        description="Manage operator accounts, roles, and access."
        isFetching={isFetching && !isLoading}
        actions={
          <Tooltip title={canWrite ? '' : 'Requires users:write permission'}>
            <span>
              <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate} disabled={!canWrite}>
                Create User
              </Button>
            </span>
          </Tooltip>
        }
      />

      {/* Error */}
      {error && (
        <ErrorState title="Couldn't load users" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Username</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Full Name</TableCell>
              <TableCell>Role</TableCell>
              <TableCell align="center">Enabled</TableCell>
              <TableCell>Last Login</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={6} columns={7} />
            ) : users && users.length > 0 ? (
              users.map((user) => (
                  <TableRow key={user.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{user.username}</Typography>
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      {[user.firstName, user.lastName].filter(Boolean).join(' ') || '-'}
                    </TableCell>
                    <TableCell>
                      <Chip label={humanize(user.role)} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title={toggleBlockedReason(user)}>
                        <span>
                          <Switch
                            size="small"
                            checked={user.enabled}
                            onChange={() => { handleToggleEnabled(user); }}
                            disabled={toggleBlockedReason(user) !== ''}
                            slotProps={{ input: { 'aria-label': `${user.enabled ? 'Disable' : 'Enable'} ${user.username}` } }}
                          />
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell>{formatTimestamp(user.lastLoginAt, { empty: 'Never' })}</TableCell>
                    <TableCell align="right">
                      <Tooltip title={canWrite ? 'Edit' : 'Requires users:write permission'}>
                        <span>
                          <IconButton aria-label="Edit user" size="small" onClick={() => { handleOpenEdit(user); }} disabled={!canWrite}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={canWrite ? 'Unlock' : 'Requires users:write permission'}>
                        <span>
                          <IconButton aria-label="Unlock user" size="small" onClick={() => { handleUnlock(user); }} disabled={!canWrite}>
                            <LockOpenIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
            ) : (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState
                    dense
                    icon={<PeopleIcon />}
                    title="No users yet"
                    description="Create an operator account to grant access to GalvaniGraph."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create/Edit Dialog */}
      <UserDialog
        open={dialogOpen}
        user={editingUser}
        onClose={handleClose}
        onSave={handleSave}
        error={dialogError}
        saving={createUser.isPending || updateUser.isPending || changePassword.isPending}
      />

      <OffboardKeysDialog
        // A fresh dialog for each user, so nothing starts ticked.
        key={disableTarget?.id ?? 'closed'}
        target={offboarding && disableTarget ? { username: disableTarget.username, keys: targetKeys } : null}
        canTakeOver={(key) => canManageKeys && coversKey(grants, key)}
        isPending={deleteUser.isPending}
        error={offboardError}
        onConfirm={handleConfirmOffboard}
        onCancel={() => { setDisableTarget(null); setOffboardError(null); }}
      />
      <KeyTokenDialog
        shown={newTokens[0] ? { name: newTokens[0].name, token: newTokens[0].token, oldSecretUntil: null } : null}
        onClose={() => { setNewTokens(newTokens.slice(1)); }}
      />
      <ConfirmDialog
        open={disableTarget !== null && !offboarding}
        title="Disable User"
        // Without the key list (no api_keys:read, or not loaded yet) the warning is still given in words.
        message={`Disable ${disableTarget?.username ?? ''}? They will no longer be able to sign in${canReadKeys && keys !== undefined ? '' : ', and any API keys they issued stop too'}.`}
        confirmLabel="Disable"
        severity="warning"
        isPending={deleteUser.isPending}
        onConfirm={() => { handleConfirmDisable(); }}
        onCancel={() => { setDisableTarget(null); }}
      />
    </Box>
  );
}
