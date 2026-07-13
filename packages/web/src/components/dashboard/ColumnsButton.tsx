// ===========================================
// Columns Button
// ===========================================
// Dashboard column-visibility control. Per-user, persisted via user preferences.

import { useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import { DASHBOARD_COLUMNS } from '../../lib/dashboard-columns.js';
import type { DashboardColumns } from '../../hooks/use-dashboard-columns.js';

export function ColumnsButton({ columns }: { columns: DashboardColumns }): ReactNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<ViewColumnIcon />}
        onClick={(e) => { setAnchor(e.currentTarget); }}
      >
        Columns
      </Button>
      <Menu open={anchor !== null} anchorEl={anchor} onClose={() => { setAnchor(null); }}>
        {DASHBOARD_COLUMNS.map((col) => {
          const checked = columns.visible.has(col.id);
          return (
            <MenuItem
              key={col.id}
              dense
              onClick={() => { columns.setVisible(col.id, !checked); }}
            >
              <ListItemIcon sx={{ minWidth: 0 }}>
                <Checkbox edge="start" size="small" checked={checked} tabIndex={-1} disableRipple />
              </ListItemIcon>
              <ListItemText>{col.label}</ListItemText>
            </MenuItem>
          );
        })}
        <Divider />
        <MenuItem dense onClick={() => { columns.reset(); }}>
          <ListItemText inset>Reset to defaults</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
