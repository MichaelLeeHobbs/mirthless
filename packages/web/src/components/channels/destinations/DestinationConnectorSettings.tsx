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
import { FileDestinationForm } from './FileDestinationForm.js';
import { DatabaseDestinationForm } from './DatabaseDestinationForm.js';
import { JavaScriptDestinationForm } from './JavaScriptDestinationForm.js';
import { SmtpDestinationForm } from './SmtpDestinationForm.js';
import { ChannelDestinationForm } from './ChannelDestinationForm.js';
import { FhirDestinationForm } from './FhirDestinationForm.js';
import { DicomDestinationForm } from './DicomDestinationForm.js';

const DEST_CONNECTOR_FORMS: Readonly<Record<string, ComponentType<DestConnectorFormProps> | undefined>> = {
  TCP_MLLP: TcpMllpDestinationForm,
  HTTP: HttpDestinationForm,
  FILE: FileDestinationForm,
  DATABASE: DatabaseDestinationForm,
  JAVASCRIPT: JavaScriptDestinationForm,
  SMTP: SmtpDestinationForm,
  CHANNEL: ChannelDestinationForm,
  FHIR: FhirDestinationForm,
  DICOM: DicomDestinationForm,
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
