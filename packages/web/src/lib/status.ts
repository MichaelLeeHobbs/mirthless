import type { ApiKeyStatus } from '@galvanigraph/core-models';
import { ROLE_FLAG } from './role-flags.js';

/** Keys of `theme.palette.status`. */
export type StatusLevel = 'healthy' | 'warning' | 'critical' | 'info' | 'neutral';

export function channelStateLevel(state: string): StatusLevel {
  switch (state) {
    case 'STARTED': return 'healthy';
    case 'PAUSED': return 'warning';
    case 'STOPPED': return 'critical';
    case 'UNDEPLOYED': return 'neutral';
    default: return 'neutral';
  }
}

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

export function eventLevelLevel(level: string): StatusLevel {
  switch (level) {
    case 'ERROR': return 'critical';
    case 'WARN': return 'warning';
    case 'INFO': return 'info';
    default: return 'neutral';
  }
}

/** Adding a channel to a group a live assignment is scoped to gives people access. */
export function groupAccessLevel(): StatusLevel {
  return 'warning';
}

/** D-313: a disabled key can be switched back on; an expired or revoked one never works again. */
export function apiKeyLevel(status: ApiKeyStatus): StatusLevel {
  switch (status) {
    case 'active': return 'healthy';
    case 'disabled': return 'warning';
    case 'expired':
    case 'revoked': return 'neutral';
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

/** An expired assignment gives nothing until renewed. */
export function assignmentLevel(expired: boolean): StatusLevel {
  return expired ? 'warning' : 'healthy';
}

export function roleFlagLevel(flag: string): StatusLevel {
  switch (flag) {
    case ROLE_FLAG.ADMIN_EQUIVALENT: return 'critical';
    case ROLE_FLAG.RUNS_CODE:
    case ROLE_FLAG.READS_PHI: return 'warning';
    case ROLE_FLAG.ALL_CHANNELS_ONLY: return 'info';
    default: return 'neutral';
  }
}

export function eventOutcomeLevel(outcome: string): StatusLevel {
  switch (outcome) {
    case 'SUCCESS': return 'healthy';
    case 'FAILURE': return 'critical';
    default: return 'neutral';
  }
}
