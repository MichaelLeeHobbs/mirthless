import { useEffect, useRef, type ReactNode } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { FHIR_DEST_DEFAULTS } from './connector-defaults.js';
import { TestConnectionButton } from '../../common/TestConnectionButton.js';
import { HeadersEditor, coerceHeaders } from '../../common/HeadersEditor.js';
import { getStr, getNum, propertyUpdaters } from '../common/connector-properties.js';
import { FHIR_METHODS, FHIR_AUTH_TYPES, FHIR_FORMATS } from '@galvanigraph/core-models';

const RESOURCE_TYPES = [
  'Patient', 'Observation', 'Encounter', 'Condition',
  'Procedure', 'MedicationRequest', 'DiagnosticReport',
  'AllergyIntolerance', 'Immunization', 'Bundle',
] as const;


export function FhirDestinationForm({ properties, onChange }: DestConnectorFormProps): ReactNode {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (Object.keys(properties).length === 0) {
      onChange({ ...FHIR_DEST_DEFAULTS });
    }
  }, [properties, onChange]);

  const { update, handleText, handleNumber } = propertyUpdaters(properties, onChange);

  const authType = getStr(properties, 'authType', 'NONE');

  return (
    <Grid container spacing={3}>
      <Grid
        size={{
          xs: 12,
          md: 6
        }}>
        <Typography
          variant="subtitle2"
          sx={{
            color: 'text.secondary',
            mb: 2
          }}>
          FHIR Server
        </Typography>

        <TextField
          label="Base URL"
          value={getStr(properties, 'baseUrl', '')}
          onChange={handleText('baseUrl')}
          helperText="FHIR R4 server base URL (e.g., https://fhir.example.com/r4)"
          fullWidth
          sx={{ mb: 2 }}
        />

        <TextField
          label="Resource Type"
          value={getStr(properties, 'resourceType', 'Patient')}
          onChange={handleText('resourceType')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {RESOURCE_TYPES.map((rt) => (
            <MenuItem key={rt} value={rt}>{rt}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Method"
          value={getStr(properties, 'method', 'POST')}
          onChange={handleText('method')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {FHIR_METHODS.map((m) => (
            <MenuItem key={m} value={m}>{m}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Format"
          value={getStr(properties, 'format', 'json')}
          onChange={handleText('format')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {FHIR_FORMATS.map((f) => (
            <MenuItem key={f} value={f}>{f === 'json' ? 'JSON (application/fhir+json)' : 'XML (application/fhir+xml)'}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="Timeout (ms)"
          type="number"
          value={getNum(properties, 'timeout', 30000)}
          onChange={handleNumber('timeout')}
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { min: 1000 } }}
        />
      </Grid>

      <Grid
        size={{
          xs: 12,
          md: 6
        }}>
        <Typography
          variant="subtitle2"
          sx={{
            color: 'text.secondary',
            mb: 2
          }}>
          Authentication
        </Typography>

        <TextField
          label="Auth Type"
          value={authType}
          onChange={handleText('authType')}
          select
          fullWidth
          sx={{ mb: 2 }}
        >
          {FHIR_AUTH_TYPES.map((at) => (
            <MenuItem key={at} value={at}>{at}</MenuItem>
          ))}
        </TextField>

        {authType === 'BASIC' && (
          <>
            <TextField
              label="Username"
              value={getStr(properties, 'authUsername', '')}
              onChange={handleText('authUsername')}
              fullWidth
              sx={{ mb: 2 }}
            />
            <TextField
              label="Password"
              type="password"
              value={getStr(properties, 'authPassword', '')}
              onChange={handleText('authPassword')}
              fullWidth
              sx={{ mb: 2 }}
            />
          </>
        )}

        {authType === 'BEARER' && (
          <TextField
            label="Bearer Token"
            value={getStr(properties, 'authToken', '')}
            onChange={handleText('authToken')}
            fullWidth
            sx={{ mb: 2 }}
          />
        )}

        {authType === 'API_KEY' && (
          <>
            <TextField
              label="Header Name"
              value={getStr(properties, 'authHeaderName', '')}
              onChange={handleText('authHeaderName')}
              helperText="e.g., X-Api-Key"
              fullWidth
              sx={{ mb: 2 }}
            />
            <TextField
              label="API Key"
              type="password"
              value={getStr(properties, 'authApiKey', '')}
              onChange={handleText('authApiKey')}
              fullWidth
              sx={{ mb: 2 }}
            />
          </>
        )}

        <Typography
          variant="subtitle2"
          sx={{
            color: 'text.secondary',
            mb: 2,
            mt: 3
          }}>
          Custom Headers
        </Typography>

        <HeadersEditor
          value={coerceHeaders(properties['headers'])}
          onChange={(headers) => { update('headers', headers); }}
          label="Extra headers sent with every request"
        />
      </Grid>

      <Grid size={12}>
        <TestConnectionButton connectorType="FHIR" mode="DESTINATION" properties={properties} />
      </Grid>
    </Grid>
  );
}
