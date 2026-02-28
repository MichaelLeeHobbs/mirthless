// ===========================================
// Scripts Tab
// ===========================================
// Channel scripts editor with Monaco Editor instances in collapsible accordions.

import { type ReactNode } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Editor from '@monaco-editor/react';

const SCRIPT_SECTIONS = [
  { key: 'deploy', label: 'Deploy Script', description: 'Runs when the channel is deployed' },
  { key: 'undeploy', label: 'Undeploy Script', description: 'Runs when the channel is undeployed' },
  { key: 'preprocessor', label: 'Preprocessor', description: 'Runs before each message enters the channel' },
  { key: 'postprocessor', label: 'Postprocessor', description: 'Runs after all destinations have processed' },
] as const;

interface ScriptsFormValues {
  deploy: string;
  undeploy: string;
  preprocessor: string;
  postprocessor: string;
}

interface ScriptsTabProps {
  readonly scripts: ScriptsFormValues;
  readonly onChange: (scripts: ScriptsFormValues) => void;
}

export function ScriptsTab({ scripts, onChange }: ScriptsTabProps): ReactNode {
  const handleScriptChange = (key: keyof ScriptsFormValues, value: string | undefined): void => {
    onChange({ ...scripts, [key]: value ?? '' });
  };

  return (
    <>
      {SCRIPT_SECTIONS.map((section) => (
        <Accordion key={section.key} disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 600, mr: 2 }}>{section.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {section.description}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <Editor
              height="250px"
              language="javascript"
              theme="vs-dark"
              value={scripts[section.key]}
              onChange={(value) => { handleScriptChange(section.key, value); }}
              options={{
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                fontSize: 13,
                tabSize: 2,
                wordWrap: 'on',
              }}
            />
          </AccordionDetails>
        </Accordion>
      ))}
    </>
  );
}
