// ===========================================
// Alert Manager
// ===========================================
// Singleton that holds loaded alert configs, evaluates events,
// and manages re-alert throttling and max-alert tracking.

import type { LoadedAlert, ChannelErrorEvent } from './alert-evaluator.js';
import { evaluateAlerts } from './alert-evaluator.js';
import { dispatchActions, type ActionDispatcherDeps } from './action-dispatcher.js';

// ----- Throttle State -----

interface AlertThrottleState {
  lastAlertAt: number;
  alertCount: number;
}

// ----- Manager -----

export class AlertManager {
  private alerts: readonly LoadedAlert[] = [];
  private readonly throttleState = new Map<string, AlertThrottleState>();
  /** NO_MESSAGES: the lastActivityAt each alert last fired for, so one silence alerts once. */
  private readonly silenceAlertedFor = new Map<string, number>();
  private deps: ActionDispatcherDeps;

  constructor(deps: ActionDispatcherDeps) {
    this.deps = deps;
  }

  /** Load or refresh the alert list (called on deploy, alert CRUD). */
  loadAlerts(alerts: readonly LoadedAlert[]): void {
    this.alerts = alerts;
  }

  /** Get the current loaded alerts. */
  getAlerts(): readonly LoadedAlert[] {
    return this.alerts;
  }

  /** Handle a channel error event: evaluate, throttle, dispatch. */
  async handleEvent(event: ChannelErrorEvent): Promise<void> {
    const matched = evaluateAlerts(event, this.alerts);

    for (const alert of matched) {
      if (this.isThrottled(alert, event.timestamp)) continue;
      if (this.isMaxedOut(alert)) continue;

      await dispatchActions(alert, event, this.deps);
      this.recordAlert(alert.id, event.timestamp);
    }
  }

  /**
   * Fire NO_MESSAGES alerts for a channel that has received nothing since
   * `lastActivityAt`. Each silence alerts once; if the alert has a re-alert
   * interval it repeats at that interval until a message arrives.
   */
  async checkSilence(channelId: string, lastActivityAt: number, now: number): Promise<void> {
    for (const alert of this.alerts) {
      const windowMinutes = alert.trigger.windowMinutes;
      if (!alert.enabled || alert.trigger.type !== 'NO_MESSAGES' || !windowMinutes) continue;
      if (alert.channelIds.length > 0 && !alert.channelIds.includes(channelId)) continue;
      if (now - lastActivityAt < windowMinutes * 60_000) continue;
      if (!this.shouldRealertSilence(alert, lastActivityAt, now)) continue;

      await dispatchActions(alert, {
        channelId,
        errorType: 'NO_MESSAGES',
        errorMessage: `No messages received in the last ${String(windowMinutes)} minutes`,
        timestamp: now,
      }, this.deps);
      this.recordAlert(alert.id, now);
      this.silenceAlertedFor.set(alert.id, lastActivityAt);
    }
  }

  /** A new silence always alerts; the same silence repeats only per reAlertIntervalMs. */
  private shouldRealertSilence(alert: LoadedAlert, lastActivityAt: number, now: number): boolean {
    if (this.isMaxedOut(alert)) return false;
    if (this.silenceAlertedFor.get(alert.id) !== lastActivityAt) return true;
    if (!alert.reAlertIntervalMs) return false;
    return !this.isThrottled(alert, now);
  }

  /** Reset throttle state for a specific alert. */
  resetAlert(alertId: string): void {
    this.throttleState.delete(alertId);
  }

  /** Clear all throttle state (e.g., on undeploy). */
  clearThrottleState(): void {
    this.throttleState.clear();
    this.silenceAlertedFor.clear();
  }

  /** Check if an alert is throttled by the re-alert interval. */
  private isThrottled(alert: LoadedAlert, now: number): boolean {
    if (alert.reAlertIntervalMs === null || alert.reAlertIntervalMs === 0) return false;
    const state = this.throttleState.get(alert.id);
    if (!state) return false;
    return (now - state.lastAlertAt) < alert.reAlertIntervalMs;
  }

  /** Check if an alert has exceeded its max-alerts limit. */
  private isMaxedOut(alert: LoadedAlert): boolean {
    if (alert.maxAlerts === null) return false;
    const state = this.throttleState.get(alert.id);
    if (!state) return false;
    return state.alertCount >= alert.maxAlerts;
  }

  /** Record that an alert has fired. */
  private recordAlert(alertId: string, timestamp: number): void {
    const existing = this.throttleState.get(alertId);
    this.throttleState.set(alertId, {
      lastAlertAt: timestamp,
      alertCount: (existing?.alertCount ?? 0) + 1,
    });
  }
}
