// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Helpers that have one home (.claude/reinvention/report.md). A non-exported
// function, or const holding a function, with one of these names is a local
// copy: import the shared one. The exported definition in its home file doesn't
// match, and neither does a plain value such as `const errorMessage = '...'`.
const SHARED_HELPERS = [
  { names: 'mapErrorToStatus|errorResponse', home: 'packages/server/src/lib/controller-helpers.ts' },
  { names: 'errorMessage|errorCode', home: 'packages/server/src/lib/controller-helpers.ts (errorResponse(error).message or .code) on the server, packages/web/src/lib/error-message.ts (errorMessage) in web' },
  { names: 'escapeCsvField', home: 'packages/server/src/lib/csv.ts' },
  { names: 'isBlockedIp|isBlockedHost|isBlockedHostname|isBlockedAddress|isReservedHostname|isReservedAddress', home: 'packages/engine/src/sandbox/ssrf.ts' },
  { names: 'isPlainObject|isRecord', home: '@galvaniflow/core-util (validation.ts)' },
  { names: 'errorInfo', home: '@galvaniflow/core-util (error-info.ts)' },
  { names: 'formatBytes', home: 'packages/web/src/lib/system-health.ts' },
  { names: 'expiryDays|expiryColor|expiryLabel', home: 'packages/web/src/lib/certificate-expiry.ts' },
  { names: 'getStr|getNum|getBool|getTls|getTlsStr|getTlsBool|propertyUpdaters', home: 'packages/web/src/components/channels/common/connector-properties.ts' },
  { names: 'compileScript|compileErrorMessages|extractEsbuildErrors', home: 'packages/engine/src/sandbox/script-compiler.ts' },
  { names: 'toPoolConfig', home: 'packages/connectors/src/database/connection-pool.ts' },
  { names: 'dispatchQuarantined', home: 'packages/connectors/src/quarantine-ledger.ts' },
  { names: 'connectFresh|closeQuietly', home: 'packages/connectors/src/client-lifecycle.ts' },
  { names: 'unescapeControlChars|readEscapes|unescapeMirth', home: '@galvaniflow/core-util (delimited.ts)' },
  { names: 'fillPlaceholders|placeholderText|placeholderNames|recordLookup', home: '@galvaniflow/core-util (placeholders.ts, D-273)' },
  { names: 'formatTimestampWith', home: 'packages/web/src/lib/format.ts (D-276)' },
  { names: 'isSecretSetting|isSecretSettingType|isSecret', home: '@galvaniflow/core-util (secret-setting.ts)' },
  { names: 'containsPattern|likePattern', home: 'packages/server/src/lib/like.ts' },
  { names: 'emitSuccessEvent|emitCollectionEvent|emitDataSourceEvent', home: 'packages/server/src/lib/event-emitter.ts' },
  { names: 'buildEventWhereConditions|buildExportWhereConditions', home: 'packages/server/src/services/event.service.ts' },
  { names: 'definedSearchParams|messageFilterParts', home: 'packages/web/src/lib/search-params.ts and message-filter-query.ts' },
  { names: 'createNodemailerTransport|buildNodemailerOptions', home: '@galvaniflow/connectors (smtp/smtp-dispatcher.ts)' },
];
const sharedHelperSelectors = SHARED_HELPERS.flatMap(({ names, home }) => [
  { selector: `:not(ExportNamedDeclaration) > FunctionDeclaration[id.name=/^(${names})$/]`, message: `Import this from ${home} instead of copying it.` },
  { selector: `:not(ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator[id.name=/^(${names})$/][init.type=/^(ArrowFunctionExpression|FunctionExpression)$/]`, message: `Import this from ${home} instead of copying it.` },
]);

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
      'no-restricted-syntax': ['error', ...sharedHelperSelectors],
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
  // styled or tested, so confirmations use ConfirmDialog. A later block's
  // no-restricted-syntax replaces an earlier one's, so this one repeats the
  // shared-helper selectors.
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
        ...sharedHelperSelectors,
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
