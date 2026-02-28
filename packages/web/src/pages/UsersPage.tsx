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
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser, useChangePassword, useUnlockUser } from '../hooks/use-users.js';
import { UserDialog, type UserFormData } from '../components/users/UserDialog.js';
import type { UserSummary } from '../api/client.js';

const ROLE_COLORS: Readonly<Record<string, 'error' | 'warning' | 'info' | 'default'>> = {
  admin: 'error',
  deployer: 'warning',
  developer: 'info',
  viewer: 'default',
};

function roleChipColor(role: string): 'error' | 'warning' | 'info' | 'default' {
  return ROLE_COLORS[role] ?? 'default';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleString();
}

export function UsersPage(): ReactNode {
  const { data: users, isLoading, error, isFetching } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const changePassword = useChangePassword();
  const unlockUser = useUnlockUser();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

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

  const handleSave = (data: UserFormData): void => {
    if (editingUser) {
      // Update existing user
      const input: Record<string, unknown> = {};
      if (data.email !== editingUser.email) input['email'] = data.email;
      if (data.firstName !== (editingUser.firstName ?? '')) input['firstName'] = data.firstName || null;
      if (data.lastName !== (editingUser.lastName ?? '')) input['lastName'] = data.lastName || null;
      if (data.role !== editingUser.role) input['role'] = data.role;

      const hasUpdates = Object.keys(input).length > 0;
      const hasPasswordChange = data.password.length >= 8;

      if (hasUpdates) {
        updateUser.mutate({ id: editingUser.id, input }, {
          onSuccess: () => {
            if (hasPasswordChange) {
              changePassword.mutate({ id: editingUser.id, newPassword: data.password });
            }
            handleClose();
          },
          onError: (err) => { setDialogError(err.message); },
        });
      } else if (hasPasswordChange) {
        changePassword.mutate({ id: editingUser.id, newPassword: data.password }, {
          onSuccess: () => { handleClose(); },
          onError: (err) => { setDialogError(err.message); },
        });
      } else {
        handleClose();
      }
    } else {
      // Create new user
      createUser.mutate({
        username: data.username,
        email: data.email,
        password: data.password,
        firstName: data.firstName || null,
        lastName: data.lastName || null,
        role: data.role as 'admin' | 'deployer' | 'developer' | 'viewer',
      }, {
        onSuccess: () => { handleClose(); },
        onError: (err) => { setDialogError(err.message); },
      });
    }
  };

  const handleToggleEnabled = (user: UserSummary): void => {
    if (user.enabled) {
      deleteUser.mutate(user.id);
    } else {
      updateUser.mutate({ id: user.id, input: { enabled: true } });
    }
  };

  const handleUnlock = (user: UserSummary): void => {
    unlockUser.mutate(user.id);
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>Users</Typography>
          {isFetching && !isLoading && <CircularProgress size={20} />}
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Create User
        </Button>
      </Box>

      {/* Error */}
      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load users: {error.message}</Alert>}

      {/* Loading */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
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
              {users && users.length > 0 ? (
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
                      <Chip
                        label={user.role}
                        color={roleChipColor(user.role)}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={user.enabled ? 'Yes' : 'No'}
                        color={user.enabled ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{formatDate(user.lastLoginAt)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => { handleOpenEdit(user); }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={user.enabled ? 'Disable' : 'Enable'}>
                        <IconButton
                          size="small"
                          onClick={() => { handleToggleEnabled(user); }}
                          color={user.enabled ? 'default' : 'success'}
                        >
                          <Chip label={user.enabled ? 'Disable' : 'Enable'} size="small" variant="outlined" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Unlock">
                        <IconButton size="small" onClick={() => { handleUnlock(user); }}>
                          <LockOpenIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                      No users found
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create/Edit Dialog */}
      <UserDialog
        open={dialogOpen}
        user={editingUser}
        onClose={handleClose}
        onSave={handleSave}
        error={dialogError}
        saving={createUser.isPending || updateUser.isPending}
      />
    </Box>
  );
}
