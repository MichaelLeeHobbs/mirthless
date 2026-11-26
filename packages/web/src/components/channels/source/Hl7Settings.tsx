// Kept on the source transformer as inboundProperties.hl7 (D-392), and
// validated with the schema deploy checks, so a bad setting shows before deploying.

import type { ReactNode } from 'react';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { hl7OptionsSchema } from '@galvanigraph/core-models';
import { getBool, propertyUpdaters } from '../common/connector-properties.js';
import { settingsProblem } from './settings-problem.js';

type Settings = Readonly<Record<string, unknown>>;

interface Hl7SettingsProps {
  readonly settings: Settings;
  readonly onChange: (settings: Record<string, unknown>) => void;
}

export function Hl7Settings({ settings, onChange }: Hl7SettingsProps): ReactNode {
  const problem = settingsProblem(hl7OptionsSchema, settings);
  const { update: set } = propertyUpdaters(settings, onChange);
  return (
    <>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5 }}>HL7 v2 settings</Typography>
      {problem !== undefined && <Alert severity="error" sx={{ mb: 2 }}>The channel will not deploy: {problem}</Alert>}
      <FormControlLabel label="The sender writes hex escapes as Unicode code points"
        control={<Switch checked={getBool(settings, 'hexCodePoints', false)} onChange={(_e, on) => { set('hexCodePoints', on); }} />} />
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Only for a sender that writes a right quote (’) as \X2019\ instead of as bytes. Scripts then read an escape of 4, 8 or more
        digits in fours as code points, whatever MSH-18 says, except a line break (\X0D0A\) and UTF-8 bytes in a message MSH-18
        says is UTF-8. Two-digit escapes are read by MSH-18 as before.
      </Typography>
    </>
  );
}
