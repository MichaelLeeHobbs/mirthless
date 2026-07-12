// ===========================================
// Design Tokens
// ===========================================
// Single source of truth for the Mirthless visual system.
//
// Direction: a calm, precise clinical instrument panel. Operators watch this
// all day, so the system favours legibility under pressure — hairline borders
// over heavy shadows, tabular numerals for every metric, and a small set of
// semantic status colours that read the same everywhere (channel states,
// message statuses, dashboard tiles).
//
// Colours are drawn from a consistent, accessibility-tested ramp. Each mode
// uses the ramp step that keeps text/marks legible against that mode's surface:
// lighter steps on the dark surface, darker steps on the white surface.

import type { PaletteMode } from '@mui/material/styles';

/** Border radius scale (px). */
export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

/** UI font (self-hosted Inter Variable) with a robust system fallback. */
export const FONT_FAMILY_SANS =
  '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Monospace stack for IDs, code, and HL7/message payloads. */
export const FONT_FAMILY_MONO =
  'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace';

/**
 * Semantic status levels — the heart of the system. Every stateful thing in the
 * app collapses onto one of these five levels, so a colour always means the same
 * thing. Status colours are reserved: they are never reused as decoration.
 */
export interface StatusPalette {
  /** Running / delivered — everything nominal. */
  readonly healthy: string;
  /** Paused / queued — attention, not yet a failure. */
  readonly warning: string;
  /** Stopped / errored — action required. */
  readonly critical: string;
  /** In-flight / received / filtered — informational. */
  readonly info: string;
  /** Undeployed / idle — inert, no signal. */
  readonly neutral: string;
}

interface ModeColors {
  readonly primary: { readonly main: string; readonly dark: string; readonly light: string; readonly contrastText: string };
  readonly secondary: { readonly main: string; readonly contrastText: string };
  readonly background: { readonly default: string; readonly paper: string };
  /** A raised surface, one step above `paper` (menus, hover, nested panels). */
  readonly surfaceRaised: string;
  /** Subtle inset surface (table header, code blocks). */
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

/** Resolve the colour set for a palette mode. */
export function colorsForMode(mode: PaletteMode): ModeColors {
  return mode === 'dark' ? dark : light;
}
