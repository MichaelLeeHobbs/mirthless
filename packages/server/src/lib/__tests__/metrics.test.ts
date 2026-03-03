// ===========================================
// Prometheus Metrics Registry Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  registry,
  httpRequestDuration,
  httpRequestTotal,
  deployedChannelsGauge,
  startedChannelsGauge,
  messagesProcessedTotal,
  dbPoolTotal,
  dbPoolIdle,
} from '../metrics.js';

describe('Prometheus Metrics Registry', () => {
  // ----- Registry -----

  it('exports a Registry instance', () => {
    expect(registry).toBeDefined();
    expect(typeof registry.metrics).toBe('function');
    expect(typeof registry.contentType).toBe('string');
  });

  it('registry.metrics() returns valid Prometheus text format', async () => {
    const output = await registry.metrics();
    expect(typeof output).toBe('string');
    // Default metrics should include process_cpu_seconds_total
    expect(output).toContain('process_cpu_seconds_total');
  });

  it('registry.contentType contains text/plain or openmetrics', () => {
    // prom-client may use either plain text or openmetrics format
    expect(registry.contentType).toMatch(/text\/plain|openmetrics/);
  });

  // ----- Default Metrics -----

  it('registers default Node.js metrics', async () => {
    const output = await registry.metrics();
    // process_cpu_seconds_total is always collected by default metrics
    expect(output).toContain('process_cpu_seconds_total');
    // nodejs_heap_size_total_bytes should also be present
    expect(output).toContain('nodejs_heap_size_total_bytes');
  });

  // ----- HTTP Request Duration -----

  it('httpRequestDuration is a Histogram with expected name', async () => {
    const output = await registry.metrics();
    expect(output).toContain('http_request_duration_seconds');
  });

  it('httpRequestDuration has correct bucket boundaries', async () => {
    // Observe a value so bucket lines appear
    httpRequestDuration.observe({ method: 'GET', route: '/test', status_code: '200' }, 0.05);
    const output = await registry.metrics();
    // Check for specific bucket boundaries
    expect(output).toContain('http_request_duration_seconds_bucket{');
    expect(output).toContain('le="0.01"');
    expect(output).toContain('le="0.05"');
    expect(output).toContain('le="10"');
  });

  it('httpRequestDuration observe updates metrics output', async () => {
    httpRequestDuration.observe({ method: 'POST', route: '/api/v1/channels', status_code: '201' }, 0.123);
    const output = await registry.metrics();
    expect(output).toContain('http_request_duration_seconds_count');
    expect(output).toContain('method="POST"');
    expect(output).toContain('route="/api/v1/channels"');
    expect(output).toContain('status_code="201"');
  });

  // ----- HTTP Request Total -----

  it('httpRequestTotal is a Counter with expected name', async () => {
    const output = await registry.metrics();
    expect(output).toContain('http_requests_total');
  });

  it('httpRequestTotal inc updates metrics output', async () => {
    httpRequestTotal.inc({ method: 'DELETE', route: '/api/v1/channels/:id', status_code: '204' });
    const output = await registry.metrics();
    expect(output).toContain('http_requests_total');
    expect(output).toContain('method="DELETE"');
  });

  // ----- Application Gauges -----

  it('deployedChannelsGauge is registered', async () => {
    deployedChannelsGauge.set(3);
    const output = await registry.metrics();
    expect(output).toContain('mirthless_deployed_channels');
    expect(output).toContain('3');
  });

  it('startedChannelsGauge is registered', async () => {
    startedChannelsGauge.set(2);
    const output = await registry.metrics();
    expect(output).toContain('mirthless_started_channels');
    expect(output).toContain('2');
  });

  it('messagesProcessedTotal is registered', async () => {
    messagesProcessedTotal.inc();
    const output = await registry.metrics();
    expect(output).toContain('mirthless_messages_processed_total');
  });

  it('dbPoolTotal is registered', async () => {
    dbPoolTotal.set(10);
    const output = await registry.metrics();
    expect(output).toContain('mirthless_db_pool_total');
  });

  it('dbPoolIdle is registered', async () => {
    dbPoolIdle.set(5);
    const output = await registry.metrics();
    expect(output).toContain('mirthless_db_pool_idle');
  });

  // ----- All Custom Metrics Present -----

  it('all custom metrics appear in registry output', async () => {
    const output = await registry.metrics();
    const expectedNames = [
      'http_request_duration_seconds',
      'http_requests_total',
      'mirthless_deployed_channels',
      'mirthless_started_channels',
      'mirthless_messages_processed_total',
      'mirthless_db_pool_total',
      'mirthless_db_pool_idle',
    ];
    for (const name of expectedNames) {
      expect(output).toContain(name);
    }
  });
});
