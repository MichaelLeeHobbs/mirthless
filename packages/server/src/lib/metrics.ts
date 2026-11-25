import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from '@prometheus-io/client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

export const deployedChannelsGauge = new Gauge({
  name: 'galvanigraph_deployed_channels',
  help: 'Number of currently deployed channels',
  registers: [registry],
});

export const startedChannelsGauge = new Gauge({
  name: 'galvanigraph_started_channels',
  help: 'Number of currently started channels',
  registers: [registry],
});

export const messagesProcessedTotal = new Counter({
  name: 'galvanigraph_messages_processed_total',
  help: 'Messages the pipeline finished since the server started: delivered, queued, filtered or recorded with an error',
  registers: [registry],
});

export const dbPoolTotal = new Gauge({
  name: 'galvanigraph_db_pool_total',
  help: 'Number of database connections the pool holds, idle ones and ones still connecting included',
  registers: [registry],
});

export const dbPoolIdle = new Gauge({
  name: 'galvanigraph_db_pool_idle',
  help: 'Number of idle database pool connections',
  registers: [registry],
});
