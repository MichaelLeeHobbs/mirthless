// ===========================================
// Connector Settings Section
// ===========================================
// Dynamically renders the correct settings form based on connector type.

import { type ReactNode, type ComponentType } from 'react';
import Typography from '@mui/material/Typography';
import type { SourceConnectorFormProps } from './types.js';
import { TcpMllpSourceForm } from './TcpMllpSourceForm.js';
import { HttpSourceForm } from './HttpSourceForm.js';
import { UnsupportedConnectorPlaceholder } from './UnsupportedConnectorPlaceholder.js';

const SOURCE_CONNECTOR_FORMS: Readonly<Record<string, ComponentType<SourceConnectorFormProps> | undefined>> = {
  TCP_MLLP: TcpMllpSourceForm,
  HTTP: HttpSourceForm,
};

interface ConnectorSettingsSectionProps {
  readonly connectorType: string;
  readonly properties: Record<string, unknown>;
  readonly onChange: (properties: Record<string, unknown>) => void;
}

export function ConnectorSettingsSection({ connectorType, properties, onChange }: ConnectorSettingsSectionProps): ReactNode {
  const FormComponent = SOURCE_CONNECTOR_FORMS[connectorType];

  return (
    <>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        Connector Settings
      </Typography>
      {FormComponent
        ? <FormComponent properties={properties} onChange={onChange} />
        : <UnsupportedConnectorPlaceholder connectorType={connectorType} />
      }
    </>
  );
}
