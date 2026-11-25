import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { readScriptLog, type ScriptLogLevel, type ScriptLogRun } from '@galvanigraph/core-models';
import { formatClockTime } from '../../lib/format.js';
import { eventLevelLevel } from '../../lib/status.js';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';
import { ContentViewer } from './ContentViewer.js';

function lineColor(level: ScriptLogLevel): string {
  if (level === 'INFO') return 'text.primary';
  return level === 'DEBUG' ? 'text.secondary' : `status.${eventLevelLevel(level)}`;
}

function more(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

function Note({ children }: { readonly children: ReactNode }): ReactNode {
  return <Typography variant="body2" sx={{ color: 'text.secondary' }}>{children}</Typography>;
}

function Run({ run }: { readonly run: ScriptLogRun }): ReactNode {
  return (
    <Box>
      <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>{run.script}</Typography>
      <Box
        component="pre"
        tabIndex={0}
        aria-label={`Log of ${run.script}`}
        sx={{
          m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, overflow: 'auto', maxHeight: 400,
          fontSize: '0.8125rem', fontFamily: FONT_FAMILY_MONO, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        }}
      >
        {run.lines.map((line, i) => (
          <Box key={i} component="span" sx={{ display: 'block', color: lineColor(line.level) }}>
            {`${formatClockTime(line.time)} ${line.level.padEnd(5)} ${line.text}`}
          </Box>
        ))}
      </Box>
      {run.leftOut > 0 ? <Note>{more(run.leftOut, 'more line of this run is not kept', 'more lines of this run are not kept')}</Note> : null}
    </Box>
  );
}

/** What the connector's scripts wrote with logger (#164). */
export function ScriptLogView({ content }: { readonly content: string }): ReactNode {
  const log = readScriptLog(content);
  if (log === null) return <ContentViewer content={content} />;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {log.earlierRuns > 0 ? <Note>{more(log.earlierRuns, 'earlier script run is not kept', 'earlier script runs are not kept')}</Note> : null}
      {log.runs.map((run, i) => <Run key={i} run={run} />)}
    </Box>
  );
}
