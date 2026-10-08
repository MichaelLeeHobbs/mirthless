import { defineConfig } from 'vitest/config';

// ===========================================
// Integration (real services) Vitest Config
// ===========================================
// Runs ONLY the *.itest.ts suites, which drive real messages through connectors
// backed by real infrastructure (Postgres, SFTP, SMTP/IMAP) provided by the
// docker-compose test services. Each suite self-skips when its service env is
// absent, so this config is safe to run anywhere. Kept separate from the default
// vitest.config.ts (which excludes *.itest.ts) so `pnpm test` never needs infra.

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.itest.ts'],
    passWithNoTests: true,
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
