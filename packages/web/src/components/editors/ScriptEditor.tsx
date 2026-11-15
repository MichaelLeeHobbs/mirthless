// ===========================================
// Script Editor
// ===========================================
// The editor for user scripts (filters, transformers, channel and global
// scripts, code templates): a language switch, format, full screen, and a status
// line with the cursor position and the script's problems.

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { SCRIPT_TEST_KINDS, ScriptLanguageCode, ScriptSurface } from '@galvaniflow/core-models';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Editor from '@monaco-editor/react';
import { applyScriptSurface, monaco } from './monaco.js';
import { useScriptDataType, useScriptTestSample } from './script-context.js';
import { useCodeTemplates } from '../../hooks/use-code-templates.js';
import { EditorFrame } from './EditorFrame.js';
import { BASE_EDITOR_OPTIONS } from './editor-options.js';
import { useCursor, useEditorTheme, useProblems } from './editor-hooks.js';
import { ProblemStatus } from './ProblemStatus.js';
import { ScriptTestPanel } from './ScriptTestPanel.js';
import { useScriptTestRun, type ScriptTestRunRequest } from '../../hooks/use-script-test-run.js';
import { ScriptReferenceButton } from './ScriptReferenceButton.js';
import { ShortcutsButton } from './ShortcutsButton.js';

const LANGUAGE_NAME: Readonly<Record<ScriptLanguageCode, string>> = {
  JAVASCRIPT: 'JavaScript',
  TYPESCRIPT: 'TypeScript',
};

/** Bounds for `height="auto"`: about five lines at least, then it scrolls. */
export const AUTO_HEIGHT = { min: 116, max: 480 } as const;

/** The editor area height for `height="auto"` given Monaco's content height. */
export function autoHeight(contentHeight: number): number {
  return Math.min(AUTO_HEIGHT.max, Math.max(AUTO_HEIGHT.min, Math.ceil(contentHeight)));
}

const MONACO_LANGUAGE: Readonly<Record<ScriptLanguageCode, string>> = {
  JAVASCRIPT: 'javascript',
  TYPESCRIPT: 'typescript',
};

export interface ScriptEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /**
   * Editor area height: a CSS length, px, "100%" to fill the host, or "auto"
   * to fit the script (between AUTO_HEIGHT.min and AUTO_HEIGHT.max, then it
   * scrolls). Defaults to 300px.
   */
  readonly height?: string | number;
  /** Names the editor for screen readers and the toolbar, e.g. "Deploy script". */
  readonly label?: string;
  /** Show the label in the toolbar. Off when the host already titles the editor. */
  readonly showLabel?: boolean;
  /** The language stored with the script. TypeScript scripts are type-checked here and at deploy. */
  readonly language?: ScriptLanguageCode;
  readonly showLanguageToggle?: boolean;
  /** Fired when the user switches JavaScript/TypeScript, so the host can store it. */
  readonly onLanguageChange?: (language: ScriptLanguageCode) => void;
  /** View-only: the code and the language cannot be changed. */
  readonly readOnly?: boolean;
  /**
   * Where the script runs: its code template context and whether it can use
   * destinationSet. Set `message: false` for scripts that run without a message
   * (deploy, undeploy); otherwise msg is typed from the channel's data type.
   */
  readonly surface?: Omit<ScriptSurface, 'dataType'> & { readonly message?: boolean };
  /**
   * How the pipeline reads this script, which turns on the Run button inside a
   * channel: filter (accepted or filtered), transformer (the changed message) or
   * script (anything else).
   */
  readonly testKind?: ScriptTestKind;
}

type ScriptTestKind = (typeof SCRIPT_TEST_KINDS)[number];

export function ScriptEditor({
  value,
  onChange,
  height = '300px',
  label = 'Script',
  showLabel = true,
  language: languageProp,
  showLanguageToggle = false,
  onLanguageChange,
  readOnly = false,
  surface: surfaceProp,
  testKind,
}: ScriptEditorProps): ReactNode {
  const theme = useEditorTheme();
  const channelDataType = useScriptDataType();
  const { data: templates } = useCodeTemplates();
  const surface = useMemo((): ScriptSurface => ({
    dataType: surfaceProp?.message === false ? undefined : channelDataType,
    destinationSet: surfaceProp?.destinationSet,
    templateContext: surfaceProp?.templateContext,
  }), [channelDataType, surfaceProp?.message, surfaceProp?.destinationSet, surfaceProp?.templateContext]);
  const [internalLang, setInternalLang] = useState<ScriptLanguageCode>('TYPESCRIPT');
  const language = languageProp ?? internalLang;
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [expanded, setExpanded] = useState(false);
  const problems = useProblems(editor);
  const cursor = useCursor(editor);
  const [contentHeight, setContentHeight] = useState<number>(AUTO_HEIGHT.min);

  useEffect(() => {
    if (!editor || height !== 'auto') return undefined;
    setContentHeight(editor.getContentHeight());
    const sub = editor.onDidContentSizeChange((e) => { setContentHeight(e.contentHeight); });
    return () => { sub.dispose(); };
  }, [editor, height]);

  // Test runs: only inside a channel (which provides the sample) and when editable.
  const testSample = useScriptTestSample();
  const testRun = useScriptTestRun();
  const [testOpen, setTestOpen] = useState(false);
  const canTest = testKind !== undefined && testSample !== undefined && !readOnly;
  const runTest = (): void => {
    if (!canTest) return;
    setTestOpen(true);
    testRun.mutate({
      script: value,
      kind: testKind,
      sample: testSample.sample,
      dataType: surface.dataType as ScriptTestRunRequest['dataType'],
      templateContext: surface.templateContext as ScriptTestRunRequest['templateContext'],
      destinationSet: surface.destinationSet === true,
      channelId: testSample.channelId,
    });
  };
  // Ctrl+Enter in the editor runs the latest script, so the action reads it through a ref.
  const runRef = useRef(runTest);
  runRef.current = runTest;
  useEffect(() => {
    if (!editor || !canTest) return undefined;
    const action = editor.addAction({
      id: 'galvaniflow.runScriptTest',
      label: 'Run against the sample message',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => { runRef.current(); },
    });
    return () => { action.dispose(); };
  }, [editor, canTest]);

  // The type service holds one set of globals; this editor's surface applies on
  // mount and whenever it takes focus.
  useEffect(() => {
    if (!editor) return undefined;
    const apply = (): void => { applyScriptSurface(surface, templates ?? []); };
    apply();
    const focus = editor.onDidFocusEditorText(apply);
    return () => { focus.dispose(); };
  }, [editor, surface, templates]);

  const start = showLanguageToggle ? (
    <ToggleButtonGroup
      value={language}
      exclusive
      size="small"
      disabled={readOnly}
      aria-label="Script language"
      onChange={(_e, val: ScriptLanguageCode | null) => {
        if (val) { setInternalLang(val); onLanguageChange?.(val); }
      }}
      sx={{
        '& .MuiToggleButton-root': {
          px: 1.25, py: 0.25, fontSize: '0.75rem', textTransform: 'none', fontWeight: 500, color: 'text.secondary',
        },
        '& .MuiToggleButton-root.Mui-selected': { color: 'primary.main', bgcolor: 'action.selected', fontWeight: 700 },
      }}
    >
      <ToggleButton value="JAVASCRIPT" aria-label="JavaScript">JavaScript</ToggleButton>
      <ToggleButton value="TYPESCRIPT" aria-label="TypeScript">TypeScript</ToggleButton>
    </ToggleButtonGroup>
  ) : null;

  const end = (
    <>
      {readOnly ? <Chip size="small" variant="outlined" label="Read only" /> : null}
      {canTest ? (
        <Tooltip title="Run against a sample message (Ctrl+Enter)">
          <Button
            size="small"
            aria-label={testOpen ? 'Run again' : 'Test run'}
            startIcon={<PlayArrowIcon fontSize="small" />}
            onClick={() => { if (testOpen) runTest(); else setTestOpen(true); }}
            sx={{ textTransform: 'none', minWidth: 0, '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } } }}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{testOpen ? 'Run' : 'Test'}</Box>
          </Button>
        </Tooltip>
      ) : null}
      {!readOnly ? <ScriptReferenceButton editor={editor} surface={surface} templates={templates ?? []} /> : null}
      <ShortcutsButton />
      {!readOnly ? (
        <Tooltip title="Format document (Shift+Alt+F)">
          <span>
            <IconButton
              size="small"
              aria-label="Format document"
              disabled={!editor}
              onClick={() => { void editor?.getAction('editor.action.formatDocument')?.run(); }}
            >
              <FormatAlignLeftIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
    </>
  );

  return (
    <EditorFrame
      label={label}
      showLabel={showLabel}
      start={start}
      end={end}
      height={height === 'auto' ? `${String(autoHeight(contentHeight))}px` : height}
      expanded={expanded}
      onExpandedChange={setExpanded}
      footer={canTest && testOpen ? (
        <ScriptTestPanel
          dataType={surface.dataType}
          sample={testSample.sample}
          onSampleChange={testSample.setSample}
          onRun={runTest}
          running={testRun.isPending}
          result={testRun.data}
          requestError={testRun.error?.message}
        />
      ) : undefined}
      status={
        <>
          <ProblemStatus editor={editor} problems={problems} />
          <Box sx={{ flexGrow: 1 }} />
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Ln {cursor.line}, Col {cursor.column}</Box>
          <Tooltip title={language === 'TYPESCRIPT'
            ? 'Saved with the script. Type errors can be saved, but the channel will not deploy until they are fixed.'
            : 'Saved with the script. JavaScript is checked for syntax only.'}
          >
            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {LANGUAGE_NAME[language]}
              <Box component="span" sx={{ display: { xs: 'none', md: 'inline' }, fontWeight: 400, color: 'text.secondary' }}>
                {language === 'TYPESCRIPT' ? ' · type-checked before deploy' : ' · syntax only'}
              </Box>
            </Box>
          </Tooltip>
        </>
      }
    >
      <Editor
        height="100%"
        language={MONACO_LANGUAGE[language]}
        theme={theme}
        value={value}
        onChange={(v) => { onChange(v ?? ''); }}
        onMount={(ed) => { setEditor(ed); }}
        options={{ ...BASE_EDITOR_OPTIONS, readOnly, ariaLabel: label, autoClosingBrackets: 'always', formatOnPaste: true }}
      />
    </EditorFrame>
  );
}
