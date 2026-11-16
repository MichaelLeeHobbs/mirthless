// ===========================================
// Script Editor
// ===========================================
// The editor for user scripts (filters, transformers, channel and global
// scripts, code templates): a language switch, format, full screen, and a status
// line with the cursor position and the script's problems.

import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { SCRIPT_TEST_KINDS, ScriptLanguageCode, ScriptSurface } from '@galvanigraph/core-models';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Editor from '@monaco-editor/react';
import { applyScriptSurface, monaco } from './monaco.js';
import { useScriptDataType, useScriptTestSample } from './script-context.js';
import { useCodeTemplates } from '../../hooks/use-code-templates.js';
import { usePermissions } from '../../hooks/use-permissions.js';
import { EditorFrame } from './EditorFrame.js';
import { BASE_EDITOR_OPTIONS } from './editor-options.js';
import {
  isExternalReplace, settledProblems, useCursor, useEditorTheme, useExternalValue, useProblems, useSuggestRoom,
} from './editor-hooks.js';
import { useScriptBodyTypeMarkers } from './script-body-check.js';
import { appliedSurfaceKey, onSurfaceApplied, surfaceLibs } from './surface-state.js';
import { EditorToolbarButton } from './EditorToolbarButton.js';
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
export function autoHeight(contentHeight: number, suggestRoomPx = 0): number {
  return Math.min(AUTO_HEIGHT.max, Math.max(AUTO_HEIGHT.min, Math.ceil(contentHeight + suggestRoomPx)));
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
  readonly surface?: Omit<ScriptSurface, 'dataType'>;
  /**
   * How the pipeline reads this script, which turns on the Run button inside a
   * channel: filter (accepted or filtered), transformer (the changed message) or
   * script (anything else).
   */
  readonly testKind?: ScriptTestKind;
  /**
   * Top-level names the enabled transformer steps before this one declare. The
   * engine runs a transformer's steps as one body, so this step can use them.
   */
  readonly earlierNames?: readonly string[] | undefined;
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
  earlierNames,
}: ScriptEditorProps): ReactNode {
  const theme = useEditorTheme();
  const channelDataType = useScriptDataType();
  const { data: templates } = useCodeTemplates();
  const surface = useMemo((): ScriptSurface => ({
    dataType: surfaceProp?.message === false ? undefined : channelDataType,
    message: surfaceProp?.message,
    destinationSet: surfaceProp?.destinationSet,
    connectorMessage: surfaceProp?.connectorMessage,
    templateContext: surfaceProp?.templateContext,
  }), [channelDataType, surfaceProp?.message, surfaceProp?.destinationSet, surfaceProp?.connectorMessage, surfaceProp?.templateContext]);
  const [internalLang, setInternalLang] = useState<ScriptLanguageCode>('TYPESCRIPT');
  const language = languageProp ?? internalLang;
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [expanded, setExpanded] = useState(false);
  const problems = useProblems(editor);
  const cursor = useCursor(editor);
  useExternalValue(editor, value);
  const [contentHeight, setContentHeight] = useState<number>(AUTO_HEIGHT.min);
  // Room the open completion list needs; above zero also means the user is mid-word.
  const suggestRoomPx = useSuggestRoom(editor);

  useEffect(() => {
    if (!editor || height !== 'auto') return undefined;
    setContentHeight(editor.getContentHeight());
    const sub = editor.onDidContentSizeChange((e) => { setContentHeight(e.contentHeight); });
    return () => { sub.dispose(); };
  }, [editor, height]);

  // Test runs: only inside a channel (which provides the sample) and when editable.
  const testSample = useScriptTestSample();
  const { has } = usePermissions();
  const testRun = useScriptTestRun();
  const [testOpen, setTestOpen] = useState(false);
  // A test run needs the permission to write channel scripts, as the server checks (D-286).
  const canTest = testKind !== undefined && testSample !== undefined && !readOnly && has('channels:write');
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
      id: 'galvanigraph.runScriptTest',
      label: 'Run against the sample message',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => { runRef.current(); },
    });
    return () => { action.dispose(); };
  }, [editor, canTest]);

  // The type service holds one set of globals; this editor's surface applies
  // whenever it takes focus, and when it changes while this editor has focus or
  // no editor has (on mount). While another editor's is applied, this one shows
  // syntax errors only and says types are checked when focused. Applying on
  // every change made a step whose earlier names changed as the focused step
  // was typed in take the surface away from it (#228).
  const earlierKey = (earlierNames ?? []).join(',');
  const libs = useMemo(
    () => surfaceLibs(surface, templates ?? [], earlierKey === '' ? [] : earlierKey.split(',')),
    [surface, templates, earlierKey],
  );
  const stale = useSyncExternalStore(onSurfaceApplied, () => appliedSurfaceKey() !== libs.key);
  useScriptBodyTypeMarkers(editor, language === 'TYPESCRIPT' && !stale);
  useEffect(() => {
    if (!editor) return undefined;
    const apply = (): void => { applyScriptSurface(libs); };
    if (editor.hasTextFocus() || !monaco.editor.getEditors().some((e) => e.hasTextFocus())) apply();
    const focus = editor.onDidFocusEditorText(apply);
    return () => { focus.dispose(); };
  }, [editor, libs]);

  // Read-only: the status line names the language; a disabled switch only looked editable.
  const start = showLanguageToggle && !readOnly ? (
    <ToggleButtonGroup
      value={language}
      exclusive
      size="small"
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
        <EditorToolbarButton
          icon={<PlayArrowIcon fontSize="small" />}
          label={testOpen ? 'Run' : 'Test'}
          ariaLabel={testOpen ? 'Run again' : 'Test run'}
          tooltip="Run against a sample message (Ctrl+Enter)"
          onClick={() => { if (testOpen) runTest(); else setTestOpen(true); }}
        />
      ) : null}
      {!readOnly ? <ScriptReferenceButton editor={editor} surface={surface} templates={templates ?? []} /> : null}
      <ShortcutsButton />
      {!readOnly ? (
        <EditorToolbarButton
          icon={<FormatAlignLeftIcon fontSize="small" />}
          label="Format"
          ariaLabel="Format document"
          tooltip="Format document (Shift+Alt+F)"
          disabled={!editor}
          onClick={() => { void editor?.getAction('editor.action.formatDocument')?.run(); }}
        />
      ) : null}
    </>
  );

  return (
    <EditorFrame
      label={label}
      showLabel={showLabel}
      start={start}
      end={end}
      height={height === 'auto' ? `${String(autoHeight(contentHeight, suggestRoomPx))}px` : height}
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
          <ProblemStatus editor={editor} problems={settledProblems(problems, cursor, suggestRoomPx > 0)} />
          {stale && language === 'TYPESCRIPT' ? (
            <Tooltip title="The type checker follows the editor you are in. Click in this one to check its types.">
              <Box component="span">Types are checked when you click in</Box>
            </Tooltip>
          ) : null}
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
        defaultValue={value}
        onChange={(v) => { if (!isExternalReplace(editor)) onChange(v ?? ''); }}
        onMount={(ed) => { setEditor(ed); }}
        options={{ ...BASE_EDITOR_OPTIONS, readOnly, ariaLabel: label, autoClosingBrackets: 'always', formatOnPaste: true }}
      />
    </EditorFrame>
  );
}
