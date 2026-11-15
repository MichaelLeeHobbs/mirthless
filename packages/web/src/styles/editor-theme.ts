// ===========================================
// Code editor themes
// ===========================================
// Monaco themes built from the app tokens, so the editor's background, gutter,
// selection and popups match the page in both modes.

import type { PaletteMode } from '@mui/material/styles';
import type { editor } from 'monaco-editor';
import { colorsForMode, syntaxForMode } from './tokens.js';

/** Monaco theme name for a palette mode. */
export function editorThemeName(mode: PaletteMode): string {
  return mode === 'dark' ? 'galvaniflow-dark' : 'galvaniflow-light';
}

/** Monaco wants `#rrggbb` or `#rrggbbaa`; the tokens also use `rgba(...)`. */
export function toMonacoColor(css: string): string {
  if (css.startsWith('#')) return css;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css);
  if (!m) throw new Error(`Unsupported colour for the editor theme: ${css}`);
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const alpha = m[4] === undefined ? '' : hex(Math.round(Number(m[4]) * 255));
  return `#${hex(r)}${hex(g)}${hex(b)}${alpha}`;
}

/** Token colours without the leading `#`, as Monaco's token rules expect. */
function bare(color: string): string {
  return color.slice(1);
}

/** The Monaco theme for a palette mode. */
export function editorTheme(mode: PaletteMode): editor.IStandaloneThemeData {
  const c = colorsForMode(mode);
  const s = syntaxForMode(mode);
  const col = toMonacoColor;
  return {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: bare(s.keyword) },
      { token: 'string', foreground: bare(s.string) },
      { token: 'string.escape', foreground: bare(s.regexp) },
      { token: 'number', foreground: bare(s.number) },
      { token: 'comment', foreground: bare(s.comment), fontStyle: 'italic' },
      { token: 'type', foreground: bare(s.type) },
      { token: 'type.identifier', foreground: bare(s.type) },
      { token: 'identifier', foreground: bare(c.text.primary) },
      { token: 'delimiter', foreground: bare(c.text.secondary) },
      { token: 'regexp', foreground: bare(s.regexp) },
      { token: 'hl7.segment', foreground: bare(s.segment), fontStyle: 'bold' },
      { token: 'hl7.delimiter', foreground: bare(s.delimiter) },
      { token: 'hl7.escape', foreground: bare(s.regexp) },
    ],
    colors: {
      'editor.background': col(c.surfaceSunken),
      'editor.foreground': col(c.text.primary),
      'editorLineNumber.foreground': col(c.text.disabled),
      'editorLineNumber.activeForeground': col(c.text.secondary),
      'editor.lineHighlightBackground': col(c.action.hover),
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': col(c.action.focus),
      'editor.inactiveSelectionBackground': col(c.action.selected),
      'editorCursor.foreground': col(c.primary.main),
      'editorIndentGuide.background1': col(c.divider),
      'editorWhitespace.foreground': col(c.divider),
      'editorGutter.background': col(c.surfaceSunken),
      'editorError.foreground': col(c.status.critical),
      'editorWarning.foreground': col(c.status.warning),
      'editorInfo.foreground': col(c.status.info),
      'editorOverviewRuler.border': '#00000000',
      'editorWidget.background': col(c.surfaceRaised),
      'editorWidget.border': col(c.divider),
      'editorHoverWidget.background': col(c.surfaceRaised),
      'editorHoverWidget.border': col(c.divider),
      'editorSuggestWidget.background': col(c.surfaceRaised),
      'editorSuggestWidget.border': col(c.divider),
      'editorSuggestWidget.foreground': col(c.text.primary),
      'editorSuggestWidget.selectedBackground': col(c.action.selected),
      'editorSuggestWidget.selectedForeground': col(c.text.primary),
      'editorSuggestWidget.selectedIconForeground': col(c.text.primary),
      'editorSuggestWidget.highlightForeground': col(c.primary.main),
      'editorSuggestWidget.focusHighlightForeground': col(c.primary.main),
      'list.hoverBackground': col(c.action.hover),
      'list.activeSelectionBackground': col(c.action.selected),
      'list.activeSelectionForeground': col(c.text.primary),
      'list.focusBackground': col(c.action.selected),
      'list.focusForeground': col(c.text.primary),
      'quickInputList.focusBackground': col(c.action.selected),
      'quickInputList.focusForeground': col(c.text.primary),
      'quickInput.background': col(c.surfaceRaised),
      'input.background': col(c.surfaceSunken),
      'input.border': col(c.divider),
      'textLink.foreground': col(c.primary.main),
      'textCodeBlock.background': col(c.surfaceSunken),
      'scrollbarSlider.background': col(c.action.focus),
      'scrollbarSlider.hoverBackground': col(c.action.focus),
      'diffEditor.insertedTextBackground': `${col(c.status.healthy)}26`,
      'diffEditor.removedTextBackground': `${col(c.status.critical)}26`,
      'diffEditor.insertedLineBackground': `${col(c.status.healthy)}14`,
      'diffEditor.removedLineBackground': `${col(c.status.critical)}14`,
      'diffEditorOverview.insertedForeground': `${col(c.status.healthy)}80`,
      'diffEditorOverview.removedForeground': `${col(c.status.critical)}80`,
      'editorOverviewRuler.background': col(c.surfaceSunken),
      focusBorder: col(c.primary.main),
    },
  };
}
