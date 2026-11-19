export function demoDataEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env['SEED_DEMO_DATA'] === 'true') return true;
  if (env['SEED_DEMO_DATA'] === 'false') return false;
  return env['NODE_ENV'] !== 'production';
}
