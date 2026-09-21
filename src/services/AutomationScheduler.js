'use strict';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** "HH:MM" in local (Hub) time — what a "daily" trigger's `time` is compared against. */
function hhmm(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** A key unique per local calendar minute, for "did this already run this minute". */
function minuteKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${hhmm(date)}`;
}

/**
 * Polls the automation list on a fixed interval and executes the scene of
 * any enabled "daily" automation whose time matches the current minute.
 *
 * Two safety rules the brief calls out explicitly, both enforced here:
 *
 * 1. "Không chạy trùng cùng một automation trong cùng một tick": a
 *    per-automation "last minute it ran" map means a matching automation
 *    fires once per calendar minute no matter how often tick() is called
 *    (or how long that minute's tick takes), and a `_running` guard means a
 *    tick already in flight is never overlapped by another.
 * 2. "Lỗi một scene không làm chết scheduler": each automation's execution
 *    is wrapped in its own try/catch inside the loop, so one bad scene (a
 *    device gone, a validation error, anything) is logged and skipped —
 *    the remaining automations in the same tick still run, and the next
 *    tick still fires.
 */
class AutomationScheduler {
  /**
   * @param {import('./automationService')} automationService
   * @param {import('./sceneService')} sceneService
   * @param {{intervalMs?: number, now?: () => Date, log?: Console}} [options]
   */
  constructor(automationService, sceneService, options = {}) {
    this.automationService = automationService;
    this.sceneService = sceneService;
    this.intervalMs = options.intervalMs || 30000;
    this._now = options.now || (() => new Date());
    this._log = options.log || console;
    this._timer = null;
    this._running = false;
    this._lastRunMinute = new Map(); // automationId -> minuteKey
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.tick().catch((err) => this._log.error(`[automation-scheduler] tick failed: ${err.message}`));
    }, this.intervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  stop() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  /** One evaluation pass. Safe to call directly (e.g. from a test with a fixed `now`). */
  async tick() {
    if (this._running) return; // a previous tick is still in flight — never overlap
    this._running = true;
    try {
      await this._runDueAutomations();
    } finally {
      this._running = false;
    }
  }

  async _runDueAutomations() {
    const now = this._now();
    const nowTime = hhmm(now);
    const currentMinuteKey = minuteKey(now);

    let automations;
    try {
      automations = await this.automationService.listAutomations();
    } catch (err) {
      this._log.error(`[automation-scheduler] could not list automations: ${err.message}`);
      return;
    }

    for (const automation of automations) {
      if (!automation.enabled) continue;
      if (!automation.trigger || automation.trigger.type !== 'daily') continue;
      if (automation.trigger.time !== nowTime) continue;
      if (this._lastRunMinute.get(automation.id) === currentMinuteKey) continue;

      this._lastRunMinute.set(automation.id, currentMinuteKey);
      await this._runOne(automation);
    }
  }

  async _runOne(automation) {
    try {
      const result = await this.sceneService.executeScene(automation.sceneId);
      const outcome = result.success ? 'success' : 'partial failure';
      this._log.log(
        `[automation-scheduler] "${automation.name}" (${automation.id}) ran scene "${result.sceneName}": ${outcome}`
      );
    } catch (err) {
      this._log.error(`[automation-scheduler] "${automation.name}" (${automation.id}) failed: ${err.message}`);
    }
  }
}

module.exports = AutomationScheduler;
