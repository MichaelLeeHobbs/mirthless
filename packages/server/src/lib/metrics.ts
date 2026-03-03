// ===========================================
// Prometheus Metrics
// ===========================================
// Configures a Prometheus metrics registry with application-specific
// counters, gauges, and histograms for observability.

import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from 'prom-client';

/** Prometheus metrics registry */
export const registry = new Registry();

// Collect Node.js default metrics (CPU, memory, event loop, GC)
collectDefaultMetrics({ register: registry });

/** HTTP request duration in seconds */
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/** Total HTTP requests counter */
export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

/** Number of currently deployed channels */
export const deployedChannelsGauge = new Gauge({
  name: 'mirthless_deployed_channels',
  help: 'Number of currently deployed channels',
  registers: [registry],
});

/** Number of currently started channels */
export const startedChannelsGauge = new Gauge({
  name: 'mirthless_started_channels',
  help: 'Number of currently started channels',
  registers: [registry],
});

/** Total messages processed counter */
export const messagesProcessedTotal = new Counter({
  name: 'mirthless_messages_processed_total',
  help: 'Total number of messages processed',
  registers: [registry],
});

/** Database pool total connections */
export const dbPoolTotal = new Gauge({
  name: 'mirthless_db_pool_total',
  help: 'Total number of database pool connections',
  registers: [registry],
});

/** Database pool idle connections */
export const dbPoolIdle = new Gauge({
  name: 'mirthless_db_pool_idle',
  help: 'Number of idle database pool connections',
  registers: [registry],
});
