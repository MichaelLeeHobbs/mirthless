import { type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import type { ScriptTestResult } from '@galvanigraph/core-models';
import { TextEditor, type TextLanguage } from './TextEditor.js';
import { useGenerateMessages } from '../../hooks/use-message-generator.js';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';

interface ScriptTestPanelProps {
  readonly dataType: string | undefined;
  readonly sample: string;
  readonly onSampleChange: (sample: string) => void;
  readonly onRun: () => void;
  readonly running: boolean;
  readonly result: ScriptTestResult | undefined;
  /** The request failed (network, permission), as opposed to the script failing. */
  readonly requestError: string | undefined;
}

const OUTCOME: Readonly<Record<ScriptTestResult['outcome'], { readonly label: string; readonly color: string }>> = {
  accepted: { label: 'Accepted', color: 'status.healthy' },
  filtered: { label: 'Filtered out', color: 'status.info' },
  completed: { label: 'Completed', color: 'status.healthy' },
  error: { label: 'Error', color: 'status.critical' },
};

function sampleLanguage(dataType: string | undefined): TextLanguage {
  if (dataType === 'HL7V2') return 'hl7';
  if (dataType === 'JSON' || dataType === 'FHIR') return 'json';
  return 'plaintext';
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Lines({ lines }: { readonly lines: readonly string[] }): ReactNode {
  return (
    <Box component="ul" sx={{ m: 0, mt: 0.5, p: 0, listStyle: 'none', fontFamily: FONT_FAMILY_MONO, fontSize: 12.5 }}>
      {lines.map((line, i) => <li key={`${String(i)}-${line}`}>{line}</li>)}
    </Box>
  );
}

function Result({ result, dataType }: { readonly result: ScriptTestResult; readonly dataType: string | undefined }): ReactNode {
  const outcome = OUTCOME[result.outcome];
  const mapLines = Object.entries(result.maps).flatMap(([map, entries]) =>
    Object.entries(entries).map(([key, value]) => `${map}['${key}'] = ${JSON.stringify(value)}`));
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          size="small"
          label={outcome.label}
          variant="outlined"
          sx={{ fontWeight: 600, color: outcome.color, borderColor: outcome.color }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {result.durationMs} ms{result.returned !== null && result.outcome !== 'accepted' && result.outcome !== 'filtered' ? ` · returned ${result.returned.slice(0, 60)}` : ''}
        </Typography>
      </Box>
      {result.error ? <Alert severity="error" sx={{ mt: 1, py: 0, '& .MuiAlert-message': { overflowWrap: 'anywhere' } }}>{result.error}</Alert> : null}
      {result.skipped.length > 0 ? (
        <Section title="Not run (a test run has no side effects)"><Lines lines={result.skipped} /></Section>
      ) : null}
      {result.output !== null ? (
        <Box sx={{ mt: 1.5 }}>
          <TextEditor label="Output message" value={result.output} language={sampleLanguage(dataType)} height="140px" />
        </Box>
      ) : null}
      {result.logs.length > 0 ? (
        <Section title="Logger"><Lines lines={result.logs.map((l) => `${l.level.padEnd(5)} ${l.message}`)} /></Section>
      ) : null}
      {mapLines.length > 0 ? <Section title="Maps set"><Lines lines={mapLines} /></Section> : null}
      {result.destinations !== null ? (
        <Section title="Goes to">
          <Lines lines={result.destinations.length > 0 ? result.destinations : ['no destination']} />
        </Section>
      ) : null}
    </Box>
  );
}

export function ScriptTestPanel({ dataType, sample, onSampleChange, onRun, running, result, requestError }: ScriptTestPanelProps): ReactNode {
  const generate = useGenerateMessages();
  return (
    <Box
      role="region"
      aria-label="Test run"
      sx={{
        display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2,
        p: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'background.default',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>Test run</Typography>
          {dataType === 'HL7V2' ? (
            <Button
              size="small"
              startIcon={generate.isPending ? <CircularProgress size={14} /> : <AutoAwesomeIcon fontSize="small" />}
              disabled={generate.isPending}
              onClick={() => {
                generate.mutate({ messageType: 'ADT_A01', count: 1 }, {
                  onSuccess: (data) => { onSampleChange(data.messages[0] ?? ''); },
                });
              }}
            >
              Generate fake ADT
            </Button>
          ) : null}
          <Button
            size="small"
            variant="contained"
            startIcon={running ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon fontSize="small" />}
            disabled={running}
            onClick={onRun}
          >
            Run
          </Button>
        </Box>
        <TextEditor
          label="Sample message"
          value={sample}
          onChange={onSampleChange}
          language={sampleLanguage(dataType)}
          height="180px"
        />
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
          Kept in this page only. A test run sends, writes and routes nothing, and its global and configuration maps start empty.
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Result</Typography>
        {requestError ? <Alert severity="error">{requestError}</Alert> : null}
        {!requestError && result ? <Result result={result} dataType={dataType} /> : null}
        {!requestError && !result ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Run the script (Ctrl+Enter in the editor) to see what it does to the sample.
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
