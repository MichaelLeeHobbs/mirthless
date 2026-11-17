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
  { names: 'escapeCsvField', home: '@galvanigraph/core-util (csv.ts)' },
  { names: 'saveFile|downloadText|downloadBlob', home: 'packages/web/src/lib/download.ts' },
  { names: 'isBlockedIp|isBlockedHost|isBlockedHostname|isBlockedAddress|isReservedHostname|isReservedAddress', home: 'packages/engine/src/sandbox/ssrf.ts' },
  { names: 'isPlainObject|isRecord', home: '@galvanigraph/core-util (validation.ts)' },
  { names: 'errorInfo', home: '@galvanigraph/core-util (error-info.ts)' },
  { names: 'formatBytes', home: 'packages/web/src/lib/system-health.ts' },
  { names: 'expiryDays|expiryColor|expiryLabel', home: 'packages/web/src/lib/certificate-expiry.ts' },
  { names: 'getStr|getNum|getBool|getTls|getTlsStr|getTlsBool|propertyUpdaters', home: 'packages/web/src/components/channels/common/connector-properties.ts' },
  { names: 'compileScript|compileErrorMessages|extractEsbuildErrors', home: 'packages/engine/src/sandbox/script-compiler.ts' },
  { names: 'wrapScriptBody|scriptBodyPosition', home: '@galvanigraph/core-models (scripting/script-check.ts, D-297)' },
  { names: 'toPoolConfig', home: 'packages/connectors/src/database/connection-pool.ts' },
  { names: 'dispatchQuarantined', home: 'packages/connectors/src/quarantine-ledger.ts' },
  { names: 'connectFresh|closeQuietly', home: 'packages/connectors/src/client-lifecycle.ts' },
  { names: 'unescapeControlChars|readEscapes|unescapeMirth', home: '@galvanigraph/core-util (delimited.ts)' },
  { names: 'fillPlaceholders|placeholderText|placeholderNames|recordLookup|hasPlaceholderText', home: '@galvanigraph/core-util (placeholders.ts, D-275)' },
  { names: 'formatTimestampWith', home: 'packages/web/src/lib/format.ts (D-278)' },
  { names: 'isSecretSetting|isSecretSettingType|isSecret', home: '@galvanigraph/core-util (secret-setting.ts)' },
  { names: 'containsPattern|likePattern', home: 'packages/server/src/lib/like.ts' },
  { names: 'emitSuccessEvent|emitCollectionEvent|emitDataSourceEvent', home: 'packages/server/src/lib/event-emitter.ts' },
  { names: 'buildEventWhereConditions|buildExportWhereConditions', home: 'packages/server/src/services/event.service.ts' },
  { names: 'definedSearchParams|messageFilterParts', home: 'packages/web/src/lib/search-params.ts and message-filter-query.ts' },
  { names: 'createNodemailerTransport|buildNodemailerOptions', home: '@galvanigraph/connectors (smtp/smtp-dispatcher.ts)' },
  { names: 'parseHeaderLines|parseHeaders|headersFromText', home: '@galvanigraph/core-models (http-connector.schema.ts)' },
  { names: 'redirectMessage', home: 'packages/connectors/src/redirect.ts' },
  { names: 'createThrottle|throttle', home: '@galvanigraph/core-util (throttle.ts, D-306)' },
];
// A permission check goes through holdsPermission or can (@galvanigraph/core-models
// authz, D-310), so the move to scoped grants changes one place, not every caller.
const permissionCheckSelectors = [
  { selector: 'CallExpression[callee.property.name=/^(includes|indexOf|has)$/][callee.object.name="permissions"]', message: 'Check a permission with holdsPermission or can from @galvanigraph/core-models (authz).' },
  { selector: 'CallExpression[callee.property.name=/^(includes|indexOf)$/][callee.object.property.name="permissions"]', message: 'Check a permission with holdsPermission or can from @galvanigraph/core-models (authz).' },
];
const sharedHelperSelectors = [...permissionCheckSelectors, ...SHARED_HELPERS.flatMap(({ names, home }) => [
  { selector: `:not(ExportNamedDeclaration) > FunctionDeclaration[id.name=/^(${names})$/]`, message: `Import this from ${home} instead of copying it.` },
  { selector: `:not(ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator[id.name=/^(${names})$/][init.type=/^(ArrowFunctionExpression|FunctionExpression)$/]`, message: `Import this from ${home} instead of copying it.` },
])];

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
        {
          // Without the pair, a screen reader (and getByLabel) names the Select by its value, not its label.
          selector: 'JSXOpeningElement[name.name="InputLabel"]:not(:has(JSXAttribute[name.name="id"]))',
          message: 'Give the InputLabel an id and its Select a matching labelId, so the select is named by its label.',
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
  // Every code editor goes through components/editors (ScriptEditor, TextEditor,
  // CodeDiffEditor), so they share one frame, theme and bundled Monaco.
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    ignores: ['packages/web/src/components/editors/**', '**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@monaco-editor/react', 'monaco-editor', 'monaco-editor/*'],
          allowTypeImports: true,
          message: 'Use ScriptEditor, TextEditor or CodeDiffEditor from components/editors.',
        }],
      }],
    },
  },
  // Playwright specs (#182, D-293). isVisible() and isHidden() answer at once without
  // waiting, so `if (await x.isVisible())` skips the test's steps when the page
  // is slow and still passes. A fixed sleep is slow when the page is fast and
  // flaky when it is slow. Wait on the condition with expect() instead.
  {
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="waitForTimeout"]',
          message: 'No fixed sleeps. Wait on the condition: await expect(locator).toBeVisible(), toHaveText(), page.waitForResponse(), expect.poll().',
        },
        {
          selector: 'CallExpression[callee.property.name=/^is(Visible|Hidden)$/]',
          message: 'isVisible()/isHidden() do not wait. Assert with await expect(locator).toBeVisible() (or toBeHidden(), or a.or(b) for either of two states).',
        },
        ...sharedHelperSelectors,
      ],
    },
  },
  // services/grant.service.ts is the only writer of roles, role permissions and
  // assignments (D-310): it applies the within, target and last-admin rules and
  // records each change. lib/principal.ts reads them for every request; the
  // schema and seeds define them. Everywhere else goes through GrantService.
  // The rule sees imports only: it cannot see db.query.roles (read-only, built
  // from the whole schema in lib/db.ts) or a raw db.execute(sql`...`). Review
  // catches those.
  {
    files: ['packages/server/src/**/*.ts'],
    ignores: [
      'packages/server/src/services/grant.service.ts',
      'packages/server/src/lib/principal.ts',
      // The Drizzle client takes the whole schema to build its query API.
      'packages/server/src/lib/db.ts',
      'packages/server/src/db/**',
      '**/__tests__/**',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/db/schema/index.js', '**/db/schema/roles.js', '**/db/schema/assignments.js'],
          importNames: ['roles', 'rolePermissions', 'assignments'],
          message: 'Read and change roles and assignments through GrantService (services/grant.service.ts).',
        }],
      }],
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
