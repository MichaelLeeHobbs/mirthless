// ===========================================
// Destination Response Transformer Section
// ===========================================
// Single-script editor (Monaco, JS/TS toggle) for a destination's response
// transformer (CT_RESPONSE_TRANSFORMED). Runs against the response returned by
// the destination after a successful send. Code-template context:
// "Dest Response Transformer".

import { type ReactNode } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ScriptLanguageCode } from '@galvanigraph/core-models';
import { ScriptEditor } from '../../editors/ScriptEditor.js';

interface ResponseTransformerSectionProps {
  readonly value: string;
  readonly onChange: (script: string) => void;
  readonly language: ScriptLanguageCode;
  readonly onLanguageChange: (language: ScriptLanguageCode) => void;
}

export function ResponseTransformerSection({ value, onChange, language, onLanguageChange }: ResponseTransformerSectionProps): ReactNode {
  const hasScript = value.trim().length > 0;

  return (
    <Accordion disableGutters>
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        aria-controls="response-transformer-content"
        id="response-transformer-header"
      >
        <Typography sx={{ fontWeight: 600, mr: 2 }}>Response Transformer</Typography>
        <Typography variant="body2" sx={{
          color: 'text.secondary'
        }}>
          {hasScript ? 'Script configured' : 'No script'}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            mb: 1
          }}>
          Transform the response returned by this destination after a successful send.
          The <code>response</code> is available as <code>msg</code>; return the new value.
        </Typography>
        <Box id="response-transformer-content">
          <ScriptEditor
            height="auto"
            label="Response transformer script"
            surface={{ templateContext: 'DESTINATION_RESPONSE_TRANSFORMER' }}
            testKind="transformer"
            value={value}
            onChange={onChange}
            language={language}
            onLanguageChange={onLanguageChange}
            showLanguageToggle
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
