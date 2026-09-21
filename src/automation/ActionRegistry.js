'use strict';

const { LIMITS, validationError, isPlainObject } = require('./schema');

/**
 * Registry of action executors — the extension point for new kinds of THEN.
 *
 * An executor is `{ type, validate(node, helpers), execute(node, ctx) }`:
 *   - `validate` (may be async) returns a cleaned node or throws a
 *     VALIDATION_ERROR (or another coded error, e.g. SCENE_NOT_FOUND).
 *     `helpers` is `{ path }`.
 *   - `execute` returns `{ success: boolean, ... }` describing the outcome.
 *
 * `execute()` on the registry never throws: an unknown type or an exception
 * becomes `{ success: false, error, code }`, so one bad action can never stop
 * the actions after it.
 */
class ActionRegistry {
  constructor() {
    this._executors = new Map();
  }

  register(executor) {
    if (!executor || typeof executor.type !== 'string' || executor.type === '') {
      throw new Error('Action executor must have a non-empty string "type"');
    }
    if (typeof executor.validate !== 'function' || typeof executor.execute !== 'function') {
      throw new Error(`Action executor "${executor.type}" must implement validate() and execute()`);
    }
    if (this._executors.has(executor.type)) {
      throw new Error(`Action type "${executor.type}" is already registered`);
    }
    this._executors.set(executor.type, executor);
    return this;
  }

  has(type) {
    return this._executors.has(type);
  }

  types() {
    return Array.from(this._executors.keys());
  }

  /** Validates the whole `then` list and returns the cleaned list. */
  async validateList(list, options = {}) {
    const path = options.path || 'then';
    if (!Array.isArray(list) || list.length < LIMITS.MIN_ACTIONS || list.length > LIMITS.MAX_ACTIONS) {
      throw validationError(`${path} must be an array of ${LIMITS.MIN_ACTIONS} to ${LIMITS.MAX_ACTIONS} actions`);
    }
    const clean = [];
    for (let i = 0; i < list.length; i += 1) {
      clean.push(await this._validateOne(list[i], `${path}[${i}]`));
    }
    return clean;
  }

  async _validateOne(node, path) {
    if (!isPlainObject(node)) {
      throw validationError(`${path} must be an object`);
    }
    if (typeof node.type !== 'string' || node.type === '') {
      throw validationError(`${path}.type must be a non-empty string`);
    }
    const executor = this._executors.get(node.type);
    if (!executor) {
      throw validationError(
        `${path}.type "${node.type}" is not a supported action type (supported: ${this.types().join(', ')})`
      );
    }
    return executor.validate(node, { path });
  }

  /** Runs one action. Never throws. */
  async execute(node, ctx) {
    const type = node && typeof node.type === 'string' ? node.type : undefined;
    const executor = type ? this._executors.get(type) : null;
    if (!executor) {
      return { type, status: 'failed', success: false, error: `unsupported action type "${type}"`, code: 'UNSUPPORTED_ACTION' };
    }
    try {
      const outcome = await executor.execute(node, ctx);
      return normalizeOutcome(type, outcome);
    } catch (err) {
      return { type, status: 'failed', success: false, error: err.message, code: err.appCode || err.code || 'ACTION_FAILED' };
    }
  }
}

const STATUSES = ['success', 'pending', 'failed'];

/**
 * Gives every executor outcome a `status` (success | pending | failed) and
 * makes sure a non-success outcome always says why, so nothing downstream can
 * end up printing "failed (undefined)". Works for custom executors too.
 */
function normalizeOutcome(type, outcome) {
  const o = isPlainObject(outcome) ? outcome : { success: false };
  const status = STATUSES.includes(o.status) ? o.status : o.success ? 'success' : 'failed';
  const normalized = { type, ...o, status };
  if (status === 'failed') {
    if (!normalized.code) normalized.code = 'ACTION_FAILED';
    if (!normalized.error) normalized.error = 'action reported failure without details';
  } else if (status === 'pending') {
    if (!normalized.code) normalized.code = 'UNCONFIRMED';
    if (!normalized.error) normalized.error = 'action was sent but its result is not confirmed yet';
  }
  return normalized;
}

module.exports = ActionRegistry;
