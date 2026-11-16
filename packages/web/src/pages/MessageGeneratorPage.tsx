// ===========================================
// Message Generator Page
// ===========================================
// Generates HL7v2 test messages with configurable options.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import type { GenerateMessagesInput } from '@galvanigraph/core-models';
import { useGenerateMessages } from '../hooks/use-message-generator.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { TextEditor } from '../components/editors/TextEditor.js';

const MESSAGE_TYPE_OPTIONS = [
  { value: 'ADT_A01', label: 'ADT^A01 — Admit/Visit' },
  { value: 'ORM_O01', label: 'ORM^O01 — Order' },
  { value: 'ORU_R01', label: 'ORU^R01 — Result' },
  { value: 'SIU_S12', label: 'SIU^S12 — Schedule' },
] as const;

export function MessageGeneratorPage(): ReactNode {
  const [messageType, setMessageType] = useState<GenerateMessagesInput['messageType']>('ADT_A01');
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState('');
  const [output, setOutput] = useState('');

  const generateMutation = useGenerateMessages();

  const handleGenerate = (): void => {
    const input: GenerateMessagesInput = {
      messageType,
      count,
      ...(seed ? { seed: Number(seed) } : {}),
    };
    generateMutation.mutate(input, {
      onSuccess: (data) => {
        setOutput(data.messages.join('\n\n---\n\n'));
      },
    });
  };

  return (
    <Box>
      <PageHeader
        title="Message Generator"
        description="Generate synthetic HL7 test messages. The data is fake, so it is safe to share."
      />

      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel id="generator-message-type-label">Message Type</InputLabel>
            <Select labelId="generator-message-type-label"
              value={messageType}
              label="Message Type"
              onChange={(e) => { setMessageType(e.target.value as GenerateMessagesInput['messageType']); }}
            >
              {MESSAGE_TYPE_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Count"
            size="small"
            type="number"
            value={count}
            onChange={(e) => { setCount(Math.min(100, Math.max(1, Number(e.target.value)))); }}
            slotProps={{ htmlInput: { min: 1, max: 100 } }}
            sx={{ width: 100 }}
          />

          <TextField
            label="Seed (optional)"
            size="small"
            type="number"
            value={seed}
            onChange={(e) => { setSeed(e.target.value); }}
            sx={{ width: 150 }}
          />

          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            startIcon={generateMutation.isPending ? <CircularProgress size={16} /> : null}
          >
            Generate
          </Button>
        </Box>
      </Paper>

      {generateMutation.isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {generateMutation.error.message}
        </Alert>
      ) : null}

      {output ? (
        <TextEditor label="Generated messages" value={output} language="hl7" height="400px" />
      ) : null}
    </Box>
  );
}
