// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Ambient declaration files legitimately use `declare var` for global
    // (globalThis) augmentation — `no-var` is a false positive there — and are
    // otherwise type-only, so exclude them from linting.
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.d.ts'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-namespace': 'off',
      'no-console': 'warn',
    },
  },
  // React Hooks rules (only for web package)
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Visual language guards (docs/design/15-visual-language.md). Colours and fonts
  // come from styles/tokens.ts through the theme; the browser's own popups can't be
  // styled or tested, so confirmations use ConfirmDialog.
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    ignores: ['packages/web/src/styles/**', '**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message: 'No hard-coded colours. Use a theme palette path (e.g. "status.critical", "text.secondary") or add a token in styles/tokens.ts.',
        },
        {
          selector: 'Literal[value=/^(rgb|hsl)a?\\(/]',
          message: 'No hard-coded colours. Use a theme palette path or add a token in styles/tokens.ts.',
        },
        {
          selector: 'Property[key.name="fontFamily"] > Literal',
          message: 'No inline font stacks. Use FONT_FAMILY_MONO from styles/tokens.ts, or the theme typography.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use ConfirmDialog instead of the browser popup.' },
        { name: 'alert', message: 'Use the notification store or an Alert instead of the browser popup.' },
        { name: 'prompt', message: 'Use a Dialog with a TextField instead of the browser popup.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm', message: 'Use ConfirmDialog instead of the browser popup.' },
        { object: 'window', property: 'alert', message: 'Use the notification store or an Alert instead of the browser popup.' },
        { object: 'window', property: 'prompt', message: 'Use a Dialog with a TextField instead of the browser popup.' },
      ],
    },
  },
  // JSX accessibility rules (only for web package)
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
    },
  }
);
