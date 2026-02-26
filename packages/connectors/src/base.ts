// ===========================================
// Base Connector Interface
// ===========================================
// All connectors implement this interface.
// Implementation deferred to Phase 3.

import type { Result } from '@mirthless/core-util';

/** Lifecycle hooks for connector instances */
export interface ConnectorLifecycle {
  /** Called when the channel is deployed */
  onDeploy(): Promise<Result<void>>;
  /** Called when the channel starts */
  onStart(): Promise<Result<void>>;
  /** Called when the channel stops */
  onStop(): Promise<Result<void>>;
  /** Called when the channel is undeployed */
  onUndeploy(): Promise<Result<void>>;
}
