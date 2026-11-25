// A partner's database, as a destination of a test channel: a table in the test database.

export function databaseDestination(name: string, queueMode: string, query: string): Record<string, unknown> {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  return {
    name, enabled: true, connectorType: 'DATABASE', queueMode, retryIntervalMs: 100,
    properties: {
      host: url.hostname, port: Number(url.port || 5432), database: url.pathname.replace(/^\//, ''),
      username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), query,
    },
  };
}
