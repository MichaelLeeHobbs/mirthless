export interface ChannelErrorEvent {
  readonly channelId: string;
  readonly errorType: string;
  readonly errorMessage: string;
  readonly timestamp: number;
}

export interface AlertTrigger {
  readonly type: string;
  readonly errorTypes: readonly string[];
  readonly regex: string | null;
  /** NO_MESSAGES only: alert after this many minutes without an inbound message. */
  readonly windowMinutes?: number | null | undefined;
}

export interface AlertAction {
  readonly id: string;
  readonly actionType: 'EMAIL' | 'CHANNEL' | 'LOG';
  readonly recipients: readonly string[];
  readonly properties: Readonly<Record<string, unknown>> | null;
}

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

function matchesTrigger(event: ChannelErrorEvent, alert: LoadedAlert): boolean {
  if (alert.trigger.type !== 'CHANNEL_ERROR') return false;

  // Empty channelIds means every channel.
  if (alert.channelIds.length > 0 && !alert.channelIds.includes(event.channelId)) {
    return false;
  }

  if (!matchesErrorType(event.errorType, alert.trigger.errorTypes)) {
    return false;
  }

  if (alert.trigger.regex) {
    if (!matchesRegex(event.errorMessage, alert.trigger.regex)) {
      return false;
    }
  }

  return true;
}

function matchesErrorType(
  eventType: string,
  triggerTypes: readonly string[],
): boolean {
  if (triggerTypes.includes('ANY')) return true;
  return triggerTypes.includes(eventType);
}

function matchesRegex(message: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern);
    return regex.test(message);
  } catch {
    // Invalid regex pattern — treat as no match
    return false;
  }
}
