import { pool } from '../lib/db.js';
import { dbPoolIdle, dbPoolTotal, deployedChannelsGauge, registry, startedChannelsGauge } from '../lib/metrics.js';
import { getEngineStats } from './health.service.js';

/** The gauges are set here, when they are read, so none is stale and no state change has to remember one. */
export function readMetrics(): Promise<string> {
  const { deployed, started } = getEngineStats();
  deployedChannelsGauge.set(deployed);
  startedChannelsGauge.set(started);
  dbPoolTotal.set(pool.totalCount);
  dbPoolIdle.set(pool.idleCount);
  return registry.metrics();
}
