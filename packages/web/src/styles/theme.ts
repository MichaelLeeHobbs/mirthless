// ===========================================
// Theme
// ===========================================
// Builds the dark and light MUI themes from the design tokens. Both modes are
// treated as first-class and equally polished — many hospital IT shops run
// light. The component overrides here are what make every page consistent
// without per-page styling: hairline-bordered surfaces, tabular numerals in
// tables, crisp status-aware chips, and a visible focus ring on everything
// interactive.

import { createTheme, alpha, type Theme, type ThemeOptions, type PaletteMode } from '@mui/material/styles';
import { colorsForMode, RADIUS, FONT_FAMILY_SANS, FONT_FAMILY_MONO, type StatusPalette } from './tokens.js';

// --- Module augmentation: status is a first-class part of the palette ---
declare module '@mui/material/styles' {
  interface Palette {
    readonly status: StatusPalette;
    readonly surfaceRaised: string;
    readonly surfaceSunken: string;
    readonly fontFamilyMono: string;
  }
  interface PaletteOptions {
    status?: StatusPalette;
    surfaceRaised?: string;
    surfaceSunken?: string;
    fontFamilyMono?: string;
  }
}

function buildTheme(mode: PaletteMode): Theme {
  const c = colorsForMode(mode);
  const isDark = mode === 'dark';

  const options: ThemeOptions = {
    shape: { borderRadius: RADIUS.md },
    palette: {
      mode,
      primary: c.primary,
      secondary: c.secondary,
      background: c.background,
      surfaceRaised: c.surfaceRaised,
      surfaceSunken: c.surfaceSunken,
      fontFamilyMono: FONT_FAMILY_MONO,
      status: c.status,
      divider: c.divider,
      text: c.text,
      action: {
        hover: c.action.hover,
        selected: c.action.selected,
        focus: c.action.focus,
      },
      error: { main: c.error },
      warning: { main: c.warning },
      info: { main: c.info },
      success: { main: c.success },
    },
    typography: {
      fontFamily: FONT_FAMILY_SANS,
      // A deliberate, compact scale tuned for a dense operational console.
      h1: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em' },
      h2: { fontSize: '1.625rem', fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.015em' },
      h3: { fontSize: '1.375rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' },
      h4: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' },
      h5: { fontSize: '1.2rem', fontWeight: 600, lineHeight: 1.35 },
      h6: { fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.4 },
      subtitle1: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.5 },
      subtitle2: { fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.5 },
      body1: { fontSize: '0.9375rem', lineHeight: 1.55 },
      body2: { fontSize: '0.875rem', lineHeight: 1.5 },
      caption: { fontSize: '0.75rem', lineHeight: 1.45 },
      overline: {
        fontSize: '0.6875rem',
        fontWeight: 700,
        lineHeight: 1.4,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': {
            colorScheme: mode,
          },
          body: {
            backgroundColor: c.background.default,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          // A single, consistent focus ring on every keyboard-focused control.
          '*:focus-visible': {
            outline: `2px solid ${c.primary.main}`,
            outlineOffset: '2px',
            borderRadius: `${RADIUS.sm}px`,
          },
          // Subtle, unobtrusive scrollbars that match the surface.
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: alpha(c.text.secondary, 0.3),
            borderRadius: 8,
            border: `2px solid ${c.background.default}`,
          },
          '*::-webkit-scrollbar-thumb:hover': { backgroundColor: alpha(c.text.secondary, 0.5) },
          '*::-webkit-scrollbar-corner': { backgroundColor: 'transparent' },
          // Respect users who prefer reduced motion.
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important',
              scrollBehavior: 'auto !important',
            },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${c.divider}`,
            borderRadius: RADIUS.lg,
          },
          // Menus/popovers get a touch of lift so they read as floating.
          elevation8: {
            border: `1px solid ${c.divider}`,
            boxShadow: isDark
              ? '0 12px 32px -8px rgba(0, 0, 0, 0.6)'
              : '0 12px 32px -12px rgba(15, 23, 42, 0.24)',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${c.divider}`,
            borderRadius: RADIUS.lg,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: RADIUS.md, paddingInline: 16 },
          sizeSmall: { paddingInline: 12 },
          containedPrimary: { color: c.primary.contrastText },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: RADIUS.sm, fontWeight: 600 },
          sizeSmall: { height: 22, fontSize: '0.75rem' },
          label: { fontVariantNumeric: 'tabular-nums' },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: isDark ? c.surfaceRaised : '#1f2937',
            color: isDark ? c.text.primary : '#f9fafb',
            border: isDark ? `1px solid ${c.divider}` : 'none',
            fontSize: '0.75rem',
            fontWeight: 500,
            borderRadius: RADIUS.sm,
            paddingBlock: 6,
            paddingInline: 10,
          },
          arrow: { color: isDark ? c.surfaceRaised : '#1f2937' },
        },
      },
      MuiTableContainer: {
        styleOverrides: { root: { borderRadius: 0 } },
      },
      MuiTable: {
        styleOverrides: {
          root: { fontVariantNumeric: 'tabular-nums' },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: c.divider,
            fontVariantNumeric: 'tabular-nums',
          },
          head: {
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: c.text.secondary,
            backgroundColor: c.surfaceSunken,
            whiteSpace: 'nowrap',
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&:hover': { backgroundColor: c.action.hover },
            '&.Mui-selected': {
              backgroundColor: c.action.selected,
              '&:hover': { backgroundColor: c.action.selected },
            },
          },
        },
      },
      MuiTableSortLabel: {
        styleOverrides: {
          root: {
            '&.Mui-active': { color: c.text.primary },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.md,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: c.divider },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: alpha(c.text.secondary, 0.5) },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: { borderRadius: RADIUS.md },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: RADIUS.md, border: `1px solid ${c.divider}`, alignItems: 'center' },
          standardError: { borderColor: alpha(c.error, 0.4) },
          standardWarning: { borderColor: alpha(c.warning, 0.4) },
          standardSuccess: { borderColor: alpha(c.success, 0.4) },
          standardInfo: { borderColor: alpha(c.info, 0.4) },
        },
      },
      MuiLinearProgress: {
        styleOverrides: { root: { borderRadius: RADIUS.pill } },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: c.divider } },
      },
    },
  };

  return createTheme(options);
}

/** Dark theme — the default for control-room / monitoring contexts. */
export const darkTheme = buildTheme('dark');

/** Light theme — fully polished for daytime hospital IT use. */
export const lightTheme = buildTheme('light');
