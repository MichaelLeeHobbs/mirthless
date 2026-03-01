// ===========================================
// Source Tab
// ===========================================
// Channel editor Source tab with connector settings, filter, transformer, and response configuration.

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import type { SourceTabProps } from './source/types.js';
import { ConnectorSettingsSection } from './source/ConnectorSettingsSection.js';
import { SourceFilterSection } from './source/SourceFilterSection.js';
import { SourceTransformerSection } from './source/SourceTransformerSection.js';
import { ResponseSettingsSection } from './source/ResponseSettingsSection.js';

export function SourceTab({
  control,
  errors,
  sourceConnectorType,
  sourceConnectorProperties,
  onPropertiesChange,
  sourceFilter,
  onSourceFilterChange,
  sourceTransformer,
  onSourceTransformerChange,
}: SourceTabProps): ReactNode {
  return (
    <Box>
      <ConnectorSettingsSection
        connectorType={sourceConnectorType}
        properties={sourceConnectorProperties}
        onChange={onPropertiesChange}
      />

      <Divider sx={{ my: 3 }} />

      <SourceFilterSection filter={sourceFilter} onChange={onSourceFilterChange} />

      <Divider sx={{ my: 3 }} />

      <SourceTransformerSection transformer={sourceTransformer} onChange={onSourceTransformerChange} />

      <Divider sx={{ my: 3 }} />

      <ResponseSettingsSection control={control} errors={errors} />
    </Box>
  );
}
