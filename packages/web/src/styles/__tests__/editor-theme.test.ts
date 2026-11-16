import { describe, it, expect } from 'vitest';
import { editorTheme, editorThemeName, toMonacoColor } from '../editor-theme.js';

describe('toMonacoColor', () => {
  it('keeps hex colours', () => {
    expect(toMonacoColor('#0b1120')).toBe('#0b1120');
  });

  it('turns rgba() into #rrggbbaa', () => {
    expect(toMonacoColor('rgba(56, 189, 248, 0.24)')).toBe('#38bdf83d');
  });

  it('turns rgb() into #rrggbb', () => {
    expect(toMonacoColor('rgb(15, 23, 42)')).toBe('#0f172a');
  });

  it('refuses a colour form Monaco cannot take, instead of passing it through', () => {
    expect(() => toMonacoColor('hsl(200, 50%, 50%)')).toThrow('Unsupported colour');
  });
});

describe('editorTheme', () => {
  it.each(['light', 'dark'] as const)('gives Monaco only #rrggbb or #rrggbbaa colours in %s mode', (mode) => {
    const theme = editorTheme(mode);
    for (const [key, value] of Object.entries(theme.colors)) {
      expect(value, key).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
    }
    for (const rule of theme.rules) {
      if (rule.foreground) expect(rule.foreground, rule.token).toMatch(/^[0-9a-f]{6}$/i);
    }
  });

  it('builds on the matching Monaco base theme', () => {
    expect(editorTheme('dark').base).toBe('vs-dark');
    expect(editorTheme('light').base).toBe('vs');
    expect(editorThemeName('dark')).not.toBe(editorThemeName('light'));
  });
});
