import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import type { monaco } from './monaco.js';
import { type Problem, revealProblem } from './editor-hooks.js';

interface ProblemStatusProps {
  readonly editor: monaco.editor.IStandaloneCodeEditor | null;
  readonly problems: readonly Problem[];
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** One missing bracket makes the parser report errors all the way down, so syntax errors after the first are counted as following it. */
export function problemSummary(problems: readonly Problem[]): string {
  const syntax = problems.filter((p) => p.severity === 'error' && p.kind === 'syntax').length;
  const type = problems.filter((p) => p.severity === 'error' && p.kind === 'type').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;
  return [
    syntax > 1 ? `1 syntax error (${String(syntax - 1)} more after it)` : null,
    syntax === 1 ? '1 syntax error' : null,
    type ? plural(type, 'type error') : null,
    // Always counted beside errors, so "no warnings" is said rather than implied.
    plural(warnings, 'warning'),
  ].filter(Boolean).join(', ');
}

export function ProblemStatus({ editor, problems }: ProblemStatusProps): ReactNode {
  const first = problems[0];

  if (!first) {
    return (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <CheckCircleOutlineIcon sx={{ fontSize: 14, color: 'status.healthy' }} />
        No problems
      </Box>
    );
  }

  const Icon = first.severity === 'error' ? ErrorOutlineIcon : WarningAmberIcon;
  return (
    <ButtonBase
      onClick={() => { if (editor) revealProblem(editor, first); }}
      aria-label={`Go to first problem, line ${String(first.line)}`}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0, borderRadius: 1, px: 0.5,
        typography: 'caption', color: 'text.primary', '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Icon sx={{ fontSize: 14, color: first.severity === 'error' ? 'status.critical' : 'status.warning' }} />
      <Box component="span" sx={{ fontWeight: 600, flexShrink: 0 }}>{problemSummary(problems)}</Box>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', color: 'text.secondary' }}>
        Line {first.line}: {first.message.split('\n')[0]}
      </Box>
    </ButtonBase>
  );
}
