// ===========================================
// Source Tab
// ===========================================
// Channel editor Source tab with connector settings and response configuration.

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import type { SourceTabProps } from './source/types.js';
import { ConnectorSettingsSection } from './source/ConnectorSettingsSection.js';
import { ResponseSettingsSection } from './source/ResponseSettingsSection.js';

export function SourceTab({
  control,
  errors,
  sourceConnectorType,
  sourceConnectorProperties,
  onPropertiesChange,
}: SourceTabProps): ReactNode {
  return (
    <Box>
      <ConnectorSettingsSection
        connectorType={sourceConnectorType}
        properties={sourceConnectorProperties}
        onChange={onPropertiesChange}
      />

      <Divider sx={{ my: 3 }} />

      <ResponseSettingsSection control={control} errors={errors} />
    </Box>
  );
}
