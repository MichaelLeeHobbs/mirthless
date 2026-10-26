// ===========================================
// Seed Options
// ===========================================

/**
 * Whether to seed demo content. SEED_DEMO_DATA=true/false wins; otherwise demo
 * data is on for development and off when NODE_ENV=production.
 */
export function demoDataEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env['SEED_DEMO_DATA'] === 'true') return true;
  if (env['SEED_DEMO_DATA'] === 'false') return false;
  return env['NODE_ENV'] !== 'production';
}
