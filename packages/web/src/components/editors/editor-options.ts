// ===========================================
// Shared editor options
// ===========================================

import type { editor } from 'monaco-editor';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';
import { overflowWidgetsHost } from './monaco.js';

/** Options every editor shares, so they type and look the same everywhere. */
export const BASE_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  // Popups (completion, hover) render at the end of <body>, so they are never clipped.
  fixedOverflowWidgets: true,
  overflowWidgetsDomNode: overflowWidgetsHost,
  hover: { above: false, delay: 300 },
  fontFamily: FONT_FAMILY_MONO,
  fontSize: 13,
  lineHeight: 20,
  padding: { top: 8, bottom: 8 },
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2,
  wordWrap: 'on',
  wrappingStrategy: 'advanced',
  renderLineHighlight: 'line',
  overviewRulerLanes: 2,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  bracketPairColorization: { enabled: true },
  guides: { indentation: true },
};
