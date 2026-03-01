// ===========================================
// Alert Evaluator
// ===========================================
// Matches channel error events against alert trigger conditions.
// Returns the list of alerts that should fire for a given event.

// ----- Types -----

/** Error event from the pipeline. */
export interface ChannelErrorEvent {
  readonly channelId: string;
  readonly errorType: string;
  readonly errorMessage: string;
  readonly timestamp: number;
}

/** Alert trigger configuration (from DB). */
export interface AlertTrigger {
  readonly type: string;
  readonly errorTypes: readonly string[];
  readonly regex: string | null;
}

/** Alert action configuration (from DB). */
export interface AlertAction {
  readonly id: string;
  readonly actionType: 'EMAIL' | 'CHANNEL';
  readonly recipients: readonly string[];
  readonly properties: Readonly<Record<string, unknown>> | null;
}

/** Loaded alert configuration. */
export interface LoadedAlert {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: AlertTrigger;
  readonly channelIds: readonly string[];
  readonly actions: readonly AlertAction[];
  readonly subjectTemplate: string | null;
  readonly bodyTemplate: string | null;
  readonly reAlertIntervalMs: number | null;
  readonly maxAlerts: number | null;
}

// ----- Evaluation -----

/** Evaluate which alerts match a given error event. */
export function evaluateAlerts(
  event: ChannelErrorEvent,
  alerts: readonly LoadedAlert[],
): readonly LoadedAlert[] {
  const matched: LoadedAlert[] = [];

  for (const alert of alerts) {
    if (!alert.enabled) continue;
    if (!matchesTrigger(event, alert)) continue;
    matched.push(alert);
  }

  return matched;
}

/** Check if an event matches an alert's trigger conditions. */
function matchesTrigger(event: ChannelErrorEvent, alert: LoadedAlert): boolean {
  // Check trigger type
  if (alert.trigger.type !== 'CHANNEL_ERROR') return false;

  // Check channel scope — empty channelIds means "all channels"
  if (alert.channelIds.length > 0 && !alert.channelIds.includes(event.channelId)) {
    return false;
  }

  // Check error type filter
  if (!matchesErrorType(event.errorType, alert.trigger.errorTypes)) {
    return false;
  }

  // Check regex filter on error message
  if (alert.trigger.regex) {
    if (!matchesRegex(event.errorMessage, alert.trigger.regex)) {
      return false;
    }
  }

  return true;
}

/** Check if an error type matches the trigger's errorTypes filter. */
function matchesErrorType(
  eventType: string,
  triggerTypes: readonly string[],
): boolean {
  if (triggerTypes.includes('ANY')) return true;
  return triggerTypes.includes(eventType);
}

/** Check if a message matches a regex pattern. */
function matchesRegex(message: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern);
    return regex.test(message);
  } catch {
    // Invalid regex pattern — treat as no match
    return false;
  }
}
