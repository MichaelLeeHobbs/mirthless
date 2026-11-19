import { type ReactNode } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import type { CertificateListQuery } from '@galvanigraph/core-models';
import { useCertificates, type CertificateSummary } from '../../../hooks/use-certificates.js';
import { expiryColor, expiryDays, expiryLabel } from '../../../lib/certificate-expiry.js';

interface CertificateSelectProps {
  readonly label: string;
  readonly value: string | undefined;
  readonly onChange: (id: string | undefined) => void;
  /** CA, CLIENT, SERVER or KEYPAIR. */
  readonly type?: string;
  readonly requirePrivateKey?: boolean;
  readonly required?: boolean;
  readonly error?: boolean;
  readonly helperText?: string;
}

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

  // An ID not in the list (still loading, deleted, filtered out) keeps a
  // placeholder, so the stored reference is not silently dropped and MUI does not warn.
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
        return (
          <TextField
            {...params}
            size="medium"
            label={label}
            required={required}
            error={error}
            helperText={helperText}
          />
        );
      }}
      sx={{ mb: 2 }}
    />
  );
}
