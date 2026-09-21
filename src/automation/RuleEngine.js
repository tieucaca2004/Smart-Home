'use strict';

const StateReader = require('./StateReader');
const { normalizeVerifyOptions, sanitizeLogText } = require('./readBack');

const NO_REASON = 'no reason reported';

function nonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * A human-readable reason for a failed action: `CODE: message`, falling back to
 * whichever part exists, then to the first failing sub-result of a scene, then
 * to a fixed text. Never contains "undefined"/"null".
 */
function describeFailure(actionResult) {
  const code = nonEmpty(actionResult.code);
  const error = nonEmpty(actionResult.error);
  if (code && error) return `${code}: ${error}`;
  if (code || error) return code || error;
  if (Array.isArray(actionResult.results)) {
    const child = actionResult.results.find((r) => r && r.success !== true && (nonEmpty(r.code) || nonEmpty(r.error)));
    if (child) return describeFailure({ code: child.code, error: child.error });
  }
  return NO_REASON;
}

/** The action's status; derived from `success` for executors that do not report one. */
function statusOf(actionResult) {
  if (actionResult.status === 'success' || actionResult.status === 'pending' || actionResult.status === 'failed') {
    return actionResult.status;
  }
  return actionResult.success ? 'success' : 'failed';
}

/**
 * Evaluates IF -> THEN rules (schema v2: `{ when, then }`) and runs their
 * actions. Protocol-agnostic: it knows only the injected condition/action
 * registries and the injected device service's `getDeviceStatus` (through
 * StateReader).
 *
 * Firing model: EDGE-triggered. A rule runs its `then` when its condition
 * goes from `false` to `true` between two evaluations - not on every tick
 * while it stays true. Consequences, all deliberate:
 *   - the first evaluation of a rule (after the Hub starts, or the rule is
 *     new / re-enabled / edited) only records its state and never fires, so a
 *     restart while a door is open does not switch things on;
 *   - a result of UNKNOWN (`null`: a sensor could not be read, no location
 *     configured, ...) never fires anything and leaves the remembered state
 *     untouched, so a brief outage neither triggers nor "re-arms" a rule;
 *     it is logged once when it starts, not on every tick.
 * Edge state lives in memory only (nothing is written to disk).
 *
 * Action results have a `status`: `success` (state confirmed by read-back),
 * `pending` (command sent, read-back has not confirmed it yet - logged as a
 * normal line, NOT a failure) or `failed` (the action really failed). Actions
 * wait at most `verify.maxTotalWaitMs` per fired rule for delayed read-backs.
 */
class RuleEngine {
  /**
   * @param {object} deps
   * @param {object} deps.deviceService Only `getDeviceStatus` is used (via StateReader).
   * @param {import('./ConditionRegistry')} deps.conditionRegistry
   * @param {import('./ActionRegistry')} deps.actionRegistry
   * @param {{latitude:number, longitude:number}|null} [deps.location]
   * @param {Console} [deps.log]
   * @param {{retryDelayMs?: number, maxTotalWaitMs?: number, sleep?: Function}} [deps.verify]
   *   Delayed read-back options: delay before the single re-read (default
   *   2000 ms, max 5000), total wait budget per fired rule (default 10000 ms,
   *   max 15000), and an injectable `sleep(ms)` for tests.
   */
  constructor({ deviceService, conditionRegistry, actionRegistry, location = null, log = console, verify }) {
    this.deviceService = deviceService;
    this.conditions = conditionRegistry;
    this.actions = actionRegistry;
    this.location = location;
    this._log = log;
    this._verify = normalizeVerifyOptions(verify);
    this._state = new Map(); // ruleId -> { version, last: boolean|undefined, unknownLogged: boolean }
  }

  /** A per-tick evaluation scope: device reads are cached for its lifetime. */
  newTick(now = new Date()) {
    return new RuleTick(this, now, new StateReader(this.deviceService));
  }

  /** Dry-run evaluation of one rule (no actions, no edge state touched). */
  evaluateRule(rule, now = new Date()) {
    return this.newTick(now).evaluateRule(rule);
  }

  /** Evaluates one rule and runs its actions if it just became true. */
  runRule(rule, now = new Date()) {
    return this.newTick(now).runRule(rule);
  }

  /** Forgets edge state of every rule not in `activeIds` (disabled or deleted rules). */
  retain(activeIds) {
    const keep = new Set(activeIds);
    for (const id of Array.from(this._state.keys())) {
      if (!keep.has(id)) this._state.delete(id);
    }
  }

  resetState(ruleId) {
    this._state.delete(ruleId);
  }
}

class RuleTick {
  constructor(engine, now, reader) {
    this.engine = engine;
    this.now = now;
    this.reader = reader;
  }

  /** @returns {Promise<{result: boolean|null, tree: object}>} */
  async evaluateRule(rule) {
    const engine = this.engine;
    const tree = await engine.conditions.trace(rule.when, {
      now: this.now,
      readState: (deviceId) => this.reader.read(deviceId),
      location: engine.location,
    });
    return { result: tree.result, tree };
  }

  /**
   * @returns {Promise<{ruleId: string, result: boolean|null, fired: boolean, actions: object[]}>}
   *   Never throws.
   */
  async runRule(rule) {
    const engine = this.engine;
    const log = engine._log;
    const label = `"${rule.name}" (${rule.id})`;
    const outcome = { ruleId: rule.id, result: null, fired: false, actions: [] };

    let result;
    try {
      result = (await this.evaluateRule(rule)).result;
    } catch (err) {
      log.error(`[rule-engine] ${label} could not be evaluated: ${err.message}`);
      return outcome;
    }
    outcome.result = result;

    const version = rule.updatedAt === undefined ? '' : String(rule.updatedAt);
    let state = engine._state.get(rule.id);
    if (!state || state.version !== version) {
      state = { version, last: undefined, unknownLogged: false };
      engine._state.set(rule.id, state);
    }

    if (result === null) {
      if (!state.unknownLogged) {
        state.unknownLogged = true;
        log.log(`[rule-engine] ${label}: condition is unknown right now (a value could not be read); no action taken`);
      }
      return outcome;
    }
    state.unknownLogged = false;

    const previous = state.last;
    state.last = result;
    if (!(result === true && previous === false)) return outcome;

    outcome.fired = true;
    log.log(`[rule-engine] ${label}: condition became true, running ${Array.isArray(rule.then) ? rule.then.length : 0} action(s)`);
    // One wait budget per fired rule, shared by all its actions.
    const verify = {
      retryDelayMs: engine._verify.retryDelayMs,
      sleep: engine._verify.sleep,
      budget: { remainingMs: engine._verify.maxTotalWaitMs },
    };
    const summary = { success: 0, pending: 0, failed: 0 };
    for (const action of Array.isArray(rule.then) ? rule.then : []) {
      let actionResult;
      try {
        actionResult = await engine.actions.execute(action, { now: this.now, verify });
      } catch (err) {
        actionResult = { type: action && action.type, status: 'failed', success: false, error: err.message, code: 'ACTION_FAILED' };
      }
      outcome.actions.push(actionResult);
      const status = statusOf(actionResult);
      summary[status] += 1;
      const target = actionResult.deviceId
        ? `${actionResult.deviceId}/${actionResult.functionCode}=${actionResult.value}`
        : actionResult.sceneId || '';
      let verdict;
      if (status === 'success') {
        verdict = actionResult.verifiedAfterRetry ? 'success (confirmed after retry)' : 'success';
      } else if (status === 'pending') {
        verdict = 'pending - command sent, read-back has not confirmed the new value yet (not a failure)';
      } else {
        verdict = `failed (${describeFailure(actionResult)})`;
      }
      const line = `[rule-engine] ${label} action ${actionResult.type || 'unknown'} ${target}: ${verdict}`;
      log.log(sanitizeLogText(line));
    }
    outcome.summary = summary;
    outcome.status = summary.failed > 0 ? 'failed' : summary.pending > 0 ? 'pending' : 'success';
    // Actions changed device state: later rules in this tick must re-read it.
    this.reader.clear();
    return outcome;
  }
}

module.exports = RuleEngine;
