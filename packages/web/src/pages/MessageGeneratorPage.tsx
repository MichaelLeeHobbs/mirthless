// ===========================================
// Message Generator Page
// ===========================================
// Generates HL7v2 test messages with configurable options.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { GenerateMessagesInput } from '@mirthless/core-models';
import Editor from '@monaco-editor/react';
import { useUiStore } from '../stores/ui.store.js';
import { useGenerateMessages } from '../hooks/use-message-generator.js';

const MESSAGE_TYPE_OPTIONS = [
  { value: 'ADT_A01', label: 'ADT^A01 — Admit/Visit' },
  { value: 'ORM_O01', label: 'ORM^O01 — Order' },
  { value: 'ORU_R01', label: 'ORU^R01 — Result' },
  { value: 'SIU_S12', label: 'SIU^S12 — Schedule' },
] as const;

export function MessageGeneratorPage(): ReactNode {
  const themeMode = useUiStore((state) => state.themeMode);
  const [messageType, setMessageType] = useState<GenerateMessagesInput['messageType']>('ADT_A01');
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState('');
  const [output, setOutput] = useState('');
  const [copied, setCopied] = useState(false);

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

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(output).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    });
  };

  return (
    <Box>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 600, mb: 3 }}>
        Message Generator
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FormControl sx={{ minWidth: 240 }}>
            <InputLabel>Message Type</InputLabel>
            <Select
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
            type="number"
            value={count}
            onChange={(e) => { setCount(Math.min(100, Math.max(1, Number(e.target.value)))); }}
            slotProps={{ htmlInput: { min: 1, max: 100 } }}
            sx={{ width: 100 }}
          />

          <TextField
            label="Seed (optional)"
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
        <Paper sx={{ position: 'relative' }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
              <IconButton size="small" onClick={handleCopy}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Editor
            height="400px"
            defaultLanguage="text"
            value={output}
            theme={themeMode === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'off',
            }}
          />
        </Paper>
      ) : null}
    </Box>
  );
}
