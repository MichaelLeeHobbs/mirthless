// The server has drivers for PostgreSQL and MySQL/MariaDB only (D-259); a
// channel imported from Mirth with another database keeps that value, and the
// field says it will not deploy.

import type { ReactNode } from 'react';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import { defaultDatabasePort } from '@galvanigraph/core-models';
import { getStr } from './connector-properties.js';

/** Must match core-models DATABASE_VENDORS; a test checks. */
export const DATABASE_VENDOR_OPTIONS = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL or MariaDB' },
] as const;

/** A connector saved before vendors existed is PostgreSQL. */
export function databaseVendor(properties: Readonly<Record<string, unknown>>): string {
  return getStr(properties, 'vendor', 'postgresql');
}

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
