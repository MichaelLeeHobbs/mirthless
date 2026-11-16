// ===========================================
// Database Vendor Field
// ===========================================
// Which database a Database Reader or Writer talks to. The server has drivers
// for PostgreSQL and MySQL/MariaDB (D-259); a channel imported from Mirth with
// another database keeps that value, and the field says it will not deploy.

import type { ReactNode } from 'react';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import { defaultDatabasePort } from '@galvanigraph/core-models';
import { getStr } from './connector-properties.js';

/** The core-models DATABASE_VENDORS with their names on screen; a test keeps the two lists equal. */
export const DATABASE_VENDOR_OPTIONS = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL or MariaDB' },
] as const;

/** The saved vendor; a connector saved before vendors existed is PostgreSQL. */
export function databaseVendor(properties: Readonly<Record<string, unknown>>): string {
  return getStr(properties, 'vendor', 'postgresql');
}

/**
 * The properties with a new vendor. A port still at the old vendor's default
 * moves to the new one's; a port someone typed stays.
 */
export function withDatabaseVendor(properties: Readonly<Record<string, unknown>>, vendor: string): Record<string, unknown> {
  const port = properties['port'];
  const followsDefault = port === undefined || port === defaultDatabasePort(databaseVendor(properties));
  return { ...properties, vendor, ...(followsDefault ? { port: defaultDatabasePort(vendor) } : {}) };
}

interface DatabaseVendorFieldProps {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly onChange: (properties: Record<string, unknown>) => void;
}

export function DatabaseVendorField({ properties, onChange }: DatabaseVendorFieldProps): ReactNode {
  const vendor = databaseVendor(properties);
  const supported = DATABASE_VENDOR_OPTIONS.some((v) => v.value === vendor);
  return (
    <TextField
      label="Database type"
      value={vendor}
      onChange={(e) => { onChange(withDatabaseVendor(properties, e.target.value)); }}
      select
      fullWidth
      error={!supported}
      helperText={supported ? undefined : `There is no driver for ${vendor}, so this channel will not deploy. Choose PostgreSQL or MySQL.`}
      sx={{ mb: 2 }}
    >
      {DATABASE_VENDOR_OPTIONS.map((v) => <MenuItem key={v.value} value={v.value}>{v.label}</MenuItem>)}
      {!supported && <MenuItem value={vendor} disabled>{vendor} (not supported)</MenuItem>}
    </TextField>
  );
}
