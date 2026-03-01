// ===========================================
// Alert Action Dispatcher
// ===========================================
// Executes alert actions: LOG writes to the logger,
// CHANNEL routes error details to a target channel.

import type { LoadedAlert, AlertAction, ChannelErrorEvent } from './alert-evaluator.js';

// ----- Types -----

/** Logger interface for LOG actions. */
export interface AlertLogger {
  warn(obj: Record<string, unknown>, message: string): void;
}

/** Callback to dispatch a message to a channel (for CHANNEL actions). */
export type ChannelSender = (
  channelId: string,
  content: string,
) => Promise<void>;

/** Dependencies for the action dispatcher. */
export interface ActionDispatcherDeps {
  readonly logger: AlertLogger;
  readonly channelSender?: ChannelSender;
}

// ----- Dispatch -----

/** Dispatch all actions for a matched alert. */
export async function dispatchActions(
  alert: LoadedAlert,
  event: ChannelErrorEvent,
  deps: ActionDispatcherDeps,
): Promise<void> {
  const content = formatAlertContent(alert, event);

  for (const action of alert.actions) {
    await dispatchSingleAction(action, alert, event, content, deps);
  }
}

/** Dispatch a single action. */
async function dispatchSingleAction(
  action: AlertAction,
  alert: LoadedAlert,
  event: ChannelErrorEvent,
  content: string,
  deps: ActionDispatcherDeps,
): Promise<void> {
  switch (action.actionType) {
    case 'EMAIL':
      // EMAIL actions are deferred until SMTP connector is wired.
      // For now, log the alert as a warning.
      deps.logger.warn(
        { alertId: alert.id, alertName: alert.name, channelId: event.channelId, recipients: action.recipients },
        `Alert "${alert.name}" triggered (EMAIL action deferred): ${event.errorMessage}`,
      );
      break;

    case 'CHANNEL': {
      const targetChannelId = action.properties?.['channelId'];
      if (typeof targetChannelId === 'string' && deps.channelSender) {
        try {
          await deps.channelSender(targetChannelId, content);
        } catch {
          deps.logger.warn(
            { alertId: alert.id, targetChannelId },
            `Failed to dispatch alert to channel ${targetChannelId}`,
          );
        }
      } else {
        deps.logger.warn(
          { alertId: alert.id, alertName: alert.name, channelId: event.channelId },
          `Alert "${alert.name}" triggered: ${event.errorMessage}`,
        );
      }
      break;
    }
  }
}

/** Format alert content for channel dispatch. */
function formatAlertContent(alert: LoadedAlert, event: ChannelErrorEvent): string {
  const body = alert.bodyTemplate
    ? substituteAlertTemplate(alert.bodyTemplate, alert, event)
    : defaultAlertBody(alert, event);
  return body;
}

/** Default alert body when no template is configured. */
function defaultAlertBody(alert: LoadedAlert, event: ChannelErrorEvent): string {
  return [
    `Alert: ${alert.name}`,
    `Channel: ${event.channelId}`,
    `Error Type: ${event.errorType}`,
    `Error: ${event.errorMessage}`,
    `Time: ${new Date(event.timestamp).toISOString()}`,
  ].join('\n');
}

/** Substitute placeholders in an alert template. */
export function substituteAlertTemplate(
  template: string,
  alert: LoadedAlert,
  event: ChannelErrorEvent,
): string {
  return template
    .replace(/\$\{alertName\}/g, alert.name)
    .replace(/\$\{channelId\}/g, event.channelId)
    .replace(/\$\{errorType\}/g, event.errorType)
    .replace(/\$\{errorMessage\}/g, event.errorMessage)
    .replace(/\$\{timestamp\}/g, new Date(event.timestamp).toISOString());
}
