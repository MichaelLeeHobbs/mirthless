// A role holding a permission the editor lacks cannot be given (the within rule, D-310).

import type { ReactNode, ChangeEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { PERMISSION_CATALOG, USER_ROLE, type Permission } from '@galvanigraph/core-models';
import { useRoles } from '../../hooks/use-roles.js';
import { usePermissions } from '../../hooks/use-permissions.js';
import { PERMISSION } from '../../lib/permissions.js';
import { roleFlags } from '../../lib/role-flags.js';
import { roleFlagLevel } from '../../lib/status.js';
import { humanize } from '../../lib/format.js';
import { StatusChip } from '../common/StatusChip.js';
import type { RoleSummary } from '../../api/client.js';

interface RoleAccessSectionProps {
  readonly value: string;
  /** A save replaces all of these with `value`. */
  readonly current: readonly string[];
  readonly onChange: (role: string) => void;
}

function labelOf(p: string): string {
  return Object.hasOwn(PERMISSION_CATALOG, p) ? PERMISSION_CATALOG[p as Permission].label : p;
}

/** A user holding several roles loses what all of them gave, since the save replaces every assignment. */
export function accessChange(from: readonly RoleSummary[], to: RoleSummary | undefined): { readonly gains: readonly string[]; readonly losses: readonly string[] } {
  const before = new Set(from.flatMap((r) => r.permissions));
  const after = new Set(to?.permissions ?? []);
  return {
    gains: [...after].filter((p) => !before.has(p)).map(labelOf),
    losses: [...before].filter((p) => !after.has(p)).map(labelOf),
  };
}

function Preview({ from, to }: { readonly from: readonly RoleSummary[]; readonly to: RoleSummary | undefined }): ReactNode {
  const { gains, losses } = accessChange(from, to);
  if (gains.length === 0 && losses.length === 0) return null;
  return (
    <Alert severity={gains.length > 0 ? 'warning' : 'info'} sx={{ mt: 1 }}>
      {gains.length > 0 && <Typography variant="body2"><strong>Gains:</strong> {gains.join(', ')}</Typography>}
      {losses.length > 0 && <Typography variant="body2"><strong>Loses:</strong> {losses.join(', ')}</Typography>}
    </Alert>
  );
}

export function RoleAccessSection({ value, current, onChange }: RoleAccessSectionProps): ReactNode {
  const { has, permissions: held } = usePermissions();
  const canReadRoles = has(PERMISSION.ROLES_READ);
  const { data: roles } = useRoles(canReadRoles);
  const options: readonly RoleSummary[] | null = roles ?? null;
  const withinEditor = (r: RoleSummary): boolean => r.permissions.every((p) => held.has(p));

  return (
    <Box>
      <TextField
        label="Role"
        select
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange(e.target.value); }}
        fullWidth
        helperText={options ? 'A new user gets this role on every channel. To give access on chosen groups, edit the user after creating them.' : 'The built-in roles are listed: the full role list needs the Read roles permission, or could not load.'}
      >
        {options
          ? options.map((r) => (
            <MenuItem key={r.id} value={r.name} disabled={!withinEditor(r)}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: '100%' }}>
                {/* Built-in names are identifiers (channel-viewer); a custom name shows as its author typed it. */}
                <span>{r.builtIn ? humanize(r.name) : r.name}</span>
                {!withinEditor(r) && <Typography variant="caption" color="text.secondary">holds permissions you don't</Typography>}
                <Box sx={{ flex: 1 }} />
                {/* The flags repeat the Roles page; kept out of the option's accessible name. */}
                <Stack direction="row" spacing={0.5} aria-hidden="true">
                  {roleFlags(r.permissions, { admin: r.admin }).slice(0, 2).map((f) => <StatusChip key={f} label={f} level={roleFlagLevel(f)} />)}
                </Stack>
              </Stack>
            </MenuItem>
          ))
          : Object.values(USER_ROLE).map((r) => <MenuItem key={r} value={r}>{humanize(r)}</MenuItem>)}
        {/* Keep a role the list does not show (several roles, or one the editor cannot read) selectable as it is. */}
        {value && !(options ? options.some((r) => r.name === value) : (Object.values(USER_ROLE) as string[]).includes(value)) && <MenuItem value={value}>{value}</MenuItem>}
      </TextField>
      {current.length > 0 && !(current.length === 1 && current[0] === value) && options && (
        <Preview from={options.filter((r) => current.includes(r.name))} to={options.find((r) => r.name === value)} />
      )}
    </Box>
  );
}
