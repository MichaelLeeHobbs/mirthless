// ===========================================
// Certificate Select
// ===========================================
// Autocomplete that selects a certificate from the certificate store by ID.
// Used by HTTPS connector forms to reference TLS material without pasting PEM.

import { type ReactNode } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import type { CertificateListQuery } from '@mirthless/core-models';
import { useCertificates, type CertificateSummary } from '../../../hooks/use-certificates.js';

interface CertificateSelectProps {
  readonly label: string;
  /** Selected certificate ID (undefined = nothing selected). */
  readonly value: string | undefined;
  readonly onChange: (id: string | undefined) => void;
  /** Restrict the list to a single certificate type (CA/CLIENT/SERVER/KEYPAIR). */
  readonly type?: string;
  /** Only show certificates that carry a private key (for server/client certs). */
  readonly requirePrivateKey?: boolean;
  readonly required?: boolean;
  readonly error?: boolean;
  readonly helperText?: string;
}

function expiryDays(notAfter: string): number {
  return Math.floor((new Date(notAfter).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function expiryColor(days: number): 'error' | 'warning' | 'success' {
  if (days < 30) return 'error';
  if (days < 90) return 'warning';
  return 'success';
}

function expiryLabel(days: number): string {
  if (days < 0) return `Expired ${String(-days)}d ago`;
  return `${String(days)}d remaining`;
}

/**
 * Certificate picker backed by the certificate store list.
 * Emits the selected certificate ID (or undefined when cleared).
 */
export function CertificateSelect({
  label,
  value,
  onChange,
  type,
  requirePrivateKey = false,
  required = false,
  error = false,
  helperText,
}: CertificateSelectProps): ReactNode {
  const query: CertificateListQuery | undefined = type ? ({ type } as CertificateListQuery) : undefined;
  const { data: certificates, isLoading } = useCertificates(query);

  const options: readonly CertificateSummary[] = (certificates ?? []).filter(
    (cert) => !requirePrivateKey || cert.hasPrivateKey,
  );

  // Resolve the selected option. If the referenced ID is not in the filtered
  // list (still loading, deleted, or filtered out) keep a placeholder so the
  // stored reference is not silently dropped and MUI does not warn.
  const selected: CertificateSummary | null =
    options.find((c) => c.id === value) ??
    (value ? ({ id: value, name: value } as CertificateSummary) : null);

  return (
    <Autocomplete<CertificateSummary>
      value={selected}
      options={[...options]}
      loading={isLoading}
      getOptionLabel={(option) => option.name}
      isOptionEqualToValue={(option, val) => option.id === val.id}
      onChange={(_e, next) => { onChange(next?.id); }}
      renderOption={(props, option) => {
        const days = expiryDays(option.notAfter);
        return (
          <Box component="li" {...props} key={option.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <span>{option.name}</span>
            {option.notAfter ? (
              <Chip label={expiryLabel(days)} size="small" color={expiryColor(days)} />
            ) : null}
          </Box>
        );
      }}
      renderInput={(params) => {
        const { InputLabelProps, InputProps, ...rest } = params;
        return (
          <TextField
            {...rest}
            size="medium"
            label={label}
            required={required}
            error={error}
            helperText={helperText}
            slotProps={{
              inputLabel: InputLabelProps,
              input: InputProps as Record<string, unknown>,
            }}
          />
        );
      }}
      sx={{ mb: 2 }}
    />
  );
}
