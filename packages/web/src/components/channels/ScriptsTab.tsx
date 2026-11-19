import { type ReactNode } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ScriptLanguageCode } from '@galvanigraph/core-models';
import { ScriptEditor } from '../editors/ScriptEditor.js';

// Deploy and undeploy run without a message, so msg is not typed there.
const SCRIPT_SECTIONS = [
  { key: 'deploy', label: 'Deploy Script', description: 'Runs when the channel is deployed', surface: { message: false, templateContext: 'CHANNEL_DEPLOY' } },
  { key: 'undeploy', label: 'Undeploy Script', description: 'Runs when the channel is undeployed', surface: { message: false, templateContext: 'CHANNEL_UNDEPLOY' } },
  { key: 'preprocessor', label: 'Preprocessor', description: 'Runs before each message enters the channel', surface: { templateContext: 'CHANNEL_PREPROCESSOR' } },
  { key: 'postprocessor', label: 'Postprocessor', description: 'Runs after all destinations have processed', surface: { templateContext: 'CHANNEL_POSTPROCESSOR' } },
] as const;

type ScriptKey = typeof SCRIPT_SECTIONS[number]['key'];

export interface ScriptsFormValues {
  deploy: string;
  undeploy: string;
  preprocessor: string;
  postprocessor: string;
  languages: Record<ScriptKey, ScriptLanguageCode>;
}

interface ScriptsTabProps {
  readonly scripts: ScriptsFormValues;
  readonly onChange: (scripts: ScriptsFormValues) => void;
}

export function ScriptsTab({ scripts, onChange }: ScriptsTabProps): ReactNode {
  const handleScriptChange = (key: ScriptKey, value: string | undefined): void => {
    onChange({ ...scripts, [key]: value ?? '' });
  };
  const handleLanguageChange = (key: ScriptKey, language: ScriptLanguageCode): void => {
    onChange({ ...scripts, languages: { ...scripts.languages, [key]: language } });
  };

  return (
    <>
      {SCRIPT_SECTIONS.map((section) => (
        <Accordion key={section.key} disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 600, mr: 2 }}>{section.label}</Typography>
            <Typography variant="body2" sx={{
              color: 'text.secondary'
            }}>
              {section.description}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: { xs: 1, sm: 2 }, pt: 0, pb: 2 }}>
            <ScriptEditor
              height="auto"
              label={section.label}
              showLabel={false}
              surface={section.surface}
              testKind="script"
              value={scripts[section.key]}
              onChange={(value) => { handleScriptChange(section.key, value); }}
              language={scripts.languages[section.key]}
              onLanguageChange={(language) => { handleLanguageChange(section.key, language); }}
              showLanguageToggle
            />
          </AccordionDetails>
        </Accordion>
      ))}
    </>
  );
}
