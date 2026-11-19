// Visual language: docs/design/15-visual-language.md. Each mode uses the ramp
// step that keeps text legible on its surface: lighter on dark, darker on white.

import type { PaletteMode } from '@mui/material/styles';

/** px */
export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export const FONT_FAMILY_SANS =
  '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const FONT_FAMILY_MONO =
  'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace';

/** Tag colours are user data, not part of the palette. */
export const TAG_COLOR = {
  default: '#2196f3',
  textOnLight: 'rgba(0, 0, 0, 0.87)',
  textOnDark: '#ffffff',
} as const;

/** Status colours are reserved: never reuse them as decoration. */
export interface StatusPalette {
  readonly healthy: string;
  readonly warning: string;
  readonly critical: string;
  readonly info: string;
  readonly neutral: string;
}

interface ModeColors {
  readonly primary: { readonly main: string; readonly dark: string; readonly light: string; readonly contrastText: string };
  readonly secondary: { readonly main: string; readonly contrastText: string };
  readonly background: { readonly default: string; readonly paper: string };
  readonly surfaceRaised: string;
  readonly surfaceSunken: string;
  readonly divider: string;
  readonly text: { readonly primary: string; readonly secondary: string; readonly disabled: string };
  readonly action: { readonly hover: string; readonly selected: string; readonly focus: string };
  readonly status: StatusPalette;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly info: string;
}

const dark: ModeColors = {
  primary: { main: '#38bdf8', dark: '#0ea5e9', light: '#7dd3fc', contrastText: '#06121f' },
  secondary: { main: '#2dd4bf', contrastText: '#04211c' },
  background: { default: '#0b1120', paper: '#131b2e' },
  surfaceRaised: '#1b2640',
  surfaceSunken: '#0e1626',
  divider: 'rgba(148, 163, 184, 0.16)',
  text: { primary: '#e6eaf3', secondary: '#98a4ba', disabled: '#5c6780' },
  action: {
    hover: 'rgba(148, 163, 184, 0.08)',
    selected: 'rgba(56, 189, 248, 0.14)',
    focus: 'rgba(56, 189, 248, 0.24)',
  },
  status: {
    healthy: '#4ade80',
    warning: '#fbbf24',
    critical: '#f87171',
    info: '#38bdf8',
    neutral: '#8b97ad',
  },
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#f87171',
  info: '#38bdf8',
};

const light: ModeColors = {
  primary: { main: '#0369a1', dark: '#075985', light: '#0ea5e9', contrastText: '#ffffff' },
  secondary: { main: '#0d9488', contrastText: '#ffffff' },
  background: { default: '#f3f6fb', paper: '#ffffff' },
  surfaceRaised: '#ffffff',
  surfaceSunken: '#f1f5fb',
  divider: 'rgba(15, 23, 42, 0.10)',
  text: { primary: '#0f1a2e', secondary: '#4a5769', disabled: '#94a3b8' },
  action: {
    hover: 'rgba(15, 23, 42, 0.04)',
    selected: 'rgba(3, 105, 161, 0.10)',
    focus: 'rgba(3, 105, 161, 0.20)',
  },
  status: {
    healthy: '#16a34a',
    warning: '#d97706',
    critical: '#dc2626',
    info: '#0284c7',
    neutral: '#64748b',
  },
  success: '#16a34a',
  warning: '#d97706',
  error: '#dc2626',
  info: '#0284c7',
};

export function colorsForMode(mode: PaletteMode): ModeColors {
  return mode === 'dark' ? dark : light;
}

/** Hues stay clear of the status colours (green, amber, red) so a squiggle or marker is never mistaken for syntax. */
export interface SyntaxColors {
  readonly keyword: string;
  readonly string: string;
  readonly number: string;
  readonly comment: string;
  readonly type: string;
  readonly func: string;
  readonly regexp: string;
  readonly segment: string;
  readonly delimiter: string;
}

const SYNTAX: Readonly<Record<PaletteMode, SyntaxColors>> = {
  dark: {
    keyword: '#c4b5fd', string: '#5eead4', number: '#fdba74', comment: '#7c89a3', type: '#7dd3fc',
    func: '#a5b4fc', regexp: '#f9a8d4', segment: '#7dd3fc', delimiter: '#7c89a3',
  },
  light: {
    keyword: '#6d28d9', string: '#0f766e', number: '#c2410c', comment: '#64748b', type: '#0369a1',
    func: '#4338ca', regexp: '#be185d', segment: '#0369a1', delimiter: '#94a3b8',
  },
};

export function syntaxForMode(mode: PaletteMode): SyntaxColors {
  return SYNTAX[mode];
}
