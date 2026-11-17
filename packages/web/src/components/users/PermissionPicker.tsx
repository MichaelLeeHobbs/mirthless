// ===========================================
// Permission Picker
// ===========================================
// The role editor's permission list, grouped by area from the permission
// catalog. A permission the editor does not hold cannot be added: the server
// refuses it (the within rule, D-310). One the role already had can be removed
// and put back, since putting it back adds nothing.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { PERMISSION_CATALOG, type Permission } from '@galvanigraph/core-models';
import { permissionFlags } from '../../lib/role-flags.js';
import { roleFlagLevel } from '../../lib/status.js';
import { StatusChip } from '../common/StatusChip.js';

interface PermissionPickerProps {
  readonly selected: ReadonlySet<string>;
  /** The permissions the editor holds; others cannot be added. */
  readonly held: ReadonlySet<string>;
  /** The permissions the role had when it was loaded; these can always be put back. */
  readonly original: ReadonlySet<string>;
  readonly readOnly: boolean;
  readonly onToggle: (permission: Permission) => void;
}

/** The catalog's permissions grouped by area, in catalog order. */
function byArea(): ReadonlyArray<readonly [string, readonly Permission[]]> {
  const groups = new Map<string, Permission[]>();
  for (const [name, info] of Object.entries(PERMISSION_CATALOG) as [Permission, (typeof PERMISSION_CATALOG)[Permission]][]) {
    groups.set(info.area, [...(groups.get(info.area) ?? []), name]);
  }
  return [...groups.entries()];
}

function PermissionRow({ permission, checked, addable, readOnly, onToggle }: {
  readonly permission: Permission; readonly checked: boolean; readonly addable: boolean; readonly readOnly: boolean;
  readonly onToggle: (permission: Permission) => void;
}): ReactNode {
  const info = PERMISSION_CATALOG[permission];
  const blocked = !checked && !addable;
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.5 }}>
      <FormControlLabel
        sx={{ mr: 0, flex: 1, alignItems: 'flex-start' }}
        control={<Checkbox size="small" checked={checked} disabled={readOnly || blocked} onChange={() => { onToggle(permission); }} sx={{ pt: 0.25 }} />}
        label={
          <Box>
            <Typography variant="body2">{info.label}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{info.description}</Typography>
            {/* In the label, so a keyboard or screen-reader user hears why the box is off. */}
            {blocked && !readOnly && <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>You can add only permissions you hold yourself.</Typography>}
          </Box>
        }
      />
      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end', rowGap: 0.5, pt: 0.5 }}>
        {permissionFlags(permission).map((flag) => <StatusChip key={flag} label={flag} level={roleFlagLevel(flag)} />)}
      </Stack>
    </Box>
  );
}

export function PermissionPicker({ selected, held, original, readOnly, onToggle }: PermissionPickerProps): ReactNode {
  return (
    <Stack spacing={2}>
      {byArea().map(([area, permissions]) => (
        <Paper key={area} variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{area}</Typography>
          {permissions.map((p) => (
            <PermissionRow key={p} permission={p} checked={selected.has(p)} addable={held.has(p) || original.has(p)} readOnly={readOnly} onToggle={onToggle} />
          ))}
        </Paper>
      ))}
    </Stack>
  );
}
