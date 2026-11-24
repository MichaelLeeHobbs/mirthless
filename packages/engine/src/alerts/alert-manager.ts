import { alertRegexError } from '@galvanigraph/core-models';
import type { LoadedAlert, ChannelErrorEvent } from './alert-evaluator.js';
import { evaluateAlerts } from './alert-evaluator.js';
import { dispatchActions, type ActionDispatcherDeps } from './action-dispatcher.js';

export const DEFAULT_REALERT_INTERVAL_MS = 60_000;

interface AlertThrottleState {
  lastAlertAt: number;
  alertCount: number;
}

export class AlertManager {
  private alerts: readonly LoadedAlert[] = [];
  private readonly throttleState = new Map<string, AlertThrottleState>();
  /** NO_MESSAGES: the lastActivityAt each alert last fired for, so one silence alerts once. */
  private readonly silenceAlertedFor = new Map<string, number>();
  private deps: ActionDispatcherDeps;

  constructor(deps: ActionDispatcherDeps) {
    this.deps = deps;
  }

  loadAlerts(alerts: readonly LoadedAlert[]): void {
    this.alerts = alerts;
    for (const alert of alerts) this.warnOfBadRegex(alert);
  }

  /** Saved before the API refused one, or written to the database. */
  private warnOfBadRegex(alert: LoadedAlert): void {
    const errMsg = alert.enabled && alert.trigger.regex ? alertRegexError(alert.trigger.regex) : null;
    if (errMsg === null) return;
    this.deps.logger.warn(
      { alertId: alert.id, alertName: alert.name, errMsg },
      `Alert "${alert.name}" never fires: its regex filter does not compile`,
    );
  }

  getAlerts(): readonly LoadedAlert[] {
    return this.alerts;
  }

  async handleEvent(event: ChannelErrorEvent): Promise<void> {
    const matched = evaluateAlerts(event, this.alerts);

    for (const alert of matched) {
      if (this.isThrottled(alert, event.timestamp)) continue;
      if (this.isMaxedOut(alert)) continue;

      // Record before sending: errors arrive in bursts, and the ones that
      // arrive while this alert is still being sent must count as throttled.
      this.recordAlert(alert.id, event.timestamp);
      await dispatchActions(alert, event, this.deps);
    }
  }

  /** Each silence alerts once, then repeats per reAlertIntervalMs (if set) until a message arrives. */
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

  private shouldRealertSilence(alert: LoadedAlert, lastActivityAt: number, now: number): boolean {
    if (this.isMaxedOut(alert)) return false;
    if (this.silenceAlertedFor.get(alert.id) !== lastActivityAt) return true;
    if (!alert.reAlertIntervalMs) return false;
    return !this.isThrottled(alert, now);
  }

  resetAlert(alertId: string): void {
    this.throttleState.delete(alertId);
  }

  clearThrottleState(): void {
    this.throttleState.clear();
    this.silenceAlertedFor.clear();
  }

  private isThrottled(alert: LoadedAlert, now: number): boolean {
    // No interval set: one alert a minute, so an outage that fails every
    // message does not send an email per message. 0 asks for every event.
    const interval = alert.reAlertIntervalMs ?? DEFAULT_REALERT_INTERVAL_MS;
    if (interval === 0) return false;
    const state = this.throttleState.get(alert.id);
    if (!state) return false;
    return (now - state.lastAlertAt) < interval;
  }

  private isMaxedOut(alert: LoadedAlert): boolean {
    if (alert.maxAlerts === null) return false;
    const state = this.throttleState.get(alert.id);
    if (!state) return false;
    return state.alertCount >= alert.maxAlerts;
  }

  private recordAlert(alertId: string, timestamp: number): void {
    const existing = this.throttleState.get(alertId);
    this.throttleState.set(alertId, {
      lastAlertAt: timestamp,
      alertCount: (existing?.alertCount ?? 0) + 1,
    });
  }
}
