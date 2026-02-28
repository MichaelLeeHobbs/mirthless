// ===========================================
// Destination Connector Settings
// ===========================================
// Dynamically renders the correct destination form based on connector type.

import { type ReactNode, type ComponentType } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { DestConnectorFormProps } from './types.js';
import { TcpMllpDestinationForm } from './TcpMllpDestinationForm.js';
import { HttpDestinationForm } from './HttpDestinationForm.js';

const DEST_CONNECTOR_FORMS: Readonly<Record<string, ComponentType<DestConnectorFormProps> | undefined>> = {
  TCP_MLLP: TcpMllpDestinationForm,
  HTTP: HttpDestinationForm,
};

interface DestinationConnectorSettingsProps {
  readonly connectorType: string;
  readonly properties: Record<string, unknown>;
  readonly onChange: (properties: Record<string, unknown>) => void;
}

export function DestinationConnectorSettings({ connectorType, properties, onChange }: DestinationConnectorSettingsProps): ReactNode {
  const FormComponent = DEST_CONNECTOR_FORMS[connectorType];

  return (
    <>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        Connector Settings
      </Typography>
      {FormComponent
        ? <FormComponent properties={properties} onChange={onChange} />
        : (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">
              {connectorType} destination connector settings are not yet available.
            </Typography>
          </Box>
        )
      }
    </>
  );
}
