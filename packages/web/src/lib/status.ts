// ===========================================
// Status Level Mapping
// ===========================================
// The one place that decides what a status "means". Channel deployment states
// and per-message statuses both collapse onto a small set of semantic levels so
// a colour reads the same everywhere in the app. Pure functions — no React — so
// they are trivially testable.

/** Semantic status levels, keyed to `theme.palette.status`. */
export type StatusLevel = 'healthy' | 'warning' | 'critical' | 'info' | 'neutral';

/**
 * Map a channel deployment state to a semantic level.
 * STARTED → healthy, PAUSED → warning, STOPPED → critical, UNDEPLOYED → neutral.
 */
export function channelStateLevel(state: string): StatusLevel {
  switch (state) {
    case 'STARTED': return 'healthy';
    case 'PAUSED': return 'warning';
    case 'STOPPED': return 'critical';
    case 'UNDEPLOYED': return 'neutral';
    default: return 'neutral';
  }
}

/**
 * Map a message (or connector) status to a semantic level.
 * SENT → healthy, ERROR → critical, QUEUED → warning,
 * FILTERED/RECEIVED/TRANSFORMED → info, otherwise neutral.
 */
export function messageStatusLevel(status: string): StatusLevel {
  switch (status) {
    case 'SENT': return 'healthy';
    case 'ERROR': return 'critical';
    case 'QUEUED': return 'warning';
    case 'FILTERED':
    case 'RECEIVED':
    case 'TRANSFORMED': return 'info';
    default: return 'neutral';
  }
}
