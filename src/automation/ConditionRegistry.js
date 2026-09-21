'use strict';

const { LIMITS, validationError, isPlainObject } = require('./schema');

/**
 * Registry of condition evaluators — the extension point for new kinds of IF.
 *
 * An evaluator is `{ type, validate(node, helpers), evaluate(node, ctx) }`:
 *   - `validate` returns a cleaned copy of the node or throws a
 *     VALIDATION_ERROR naming the offending path. `helpers` is
 *     `{ path, location, validateChild(child, childPath) }`.
 *   - `evaluate` returns `true`, `false`, or `null` (= UNKNOWN: the value could
 *     not be read). `ctx` is `{ now, readState(deviceId), location, evaluate(child) }`.
 *     `readState` yields `[{code, value}]` or `null`; evaluators never see a
 *     device service, an adapter or any vendor SDK.
 *
 * Adding a new condition type = one evaluator file + one `register` call in
 * createDefaultRegistries.js. Nothing in RuleEngine/AutomationService/the
 * scheduler changes.
 */
class ConditionRegistry {
  constructor() {
    this._evaluators = new Map();
  }

  register(evaluator) {
    if (!evaluator || typeof evaluator.type !== 'string' || evaluator.type === '') {
      throw new Error('Condition evaluator must have a non-empty string "type"');
    }
    if (typeof evaluator.validate !== 'function' || typeof evaluator.evaluate !== 'function') {
      throw new Error(`Condition evaluator "${evaluator.type}" must implement validate() and evaluate()`);
    }
    if (this._evaluators.has(evaluator.type)) {
      throw new Error(`Condition type "${evaluator.type}" is already registered`);
    }
    this._evaluators.set(evaluator.type, evaluator);
    return this;
  }

  has(type) {
    return this._evaluators.has(type);
  }

  get(type) {
    return this._evaluators.get(type) || null;
  }

  types() {
    return Array.from(this._evaluators.keys());
  }

  /**
   * Validates a whole condition tree and returns the cleaned tree.
   * @param {*} root
   * @param {{path?: string, location?: ({latitude:number, longitude:number}|null)}} [options]
   */
  validateTree(root, options = {}) {
    const state = { count: 0 };
    return this._validateNode(root, options.path || 'when', 1, state, options);
  }

  _validateNode(node, path, depth, state, options) {
    if (!isPlainObject(node)) {
      throw validationError(`${path} must be an object`);
    }
    if (depth > LIMITS.MAX_DEPTH) {
      throw validationError(`${path} is nested deeper than ${LIMITS.MAX_DEPTH} levels`);
    }
    state.count += 1;
    if (state.count > LIMITS.MAX_NODES) {
      throw validationError(`"when" has more than ${LIMITS.MAX_NODES} conditions`);
    }
    if (typeof node.type !== 'string' || node.type === '') {
      throw validationError(`${path}.type must be a non-empty string`);
    }
    const evaluator = this._evaluators.get(node.type);
    if (!evaluator) {
      throw validationError(
        `${path}.type "${node.type}" is not a supported condition type (supported: ${this.types().join(', ')})`
      );
    }
    const helpers = {
      path,
      location: options.location || null,
      validateChild: (child, childPath) => this._validateNode(child, childPath, depth + 1, state, options),
    };
    return evaluator.validate(node, helpers);
  }

  /** Evaluates a node to `true` | `false` | `null`. Never throws. */
  async evaluate(node, ctx) {
    return (await this.trace(node, ctx)).result;
  }

  /**
   * Like evaluate(), but returns the whole evaluation tree
   * `{ type, result, children?, error? }` — used by the dry-run endpoint.
   * Any exception inside an evaluator becomes `result: null` (UNKNOWN); it
   * never propagates, so a broken condition can never crash a scheduler tick.
   */
  async trace(node, ctx) {
    const type = node && typeof node.type === 'string' ? node.type : undefined;
    const entry = { type, result: null };
    const evaluator = type ? this._evaluators.get(type) : null;
    if (!evaluator) {
      entry.error = `unsupported condition type "${type}"`;
      return entry;
    }
    const children = [];
    const childCtx = {
      ...ctx,
      evaluate: async (child) => {
        const childTrace = await this.trace(child, ctx);
        children.push(childTrace);
        return childTrace.result;
      },
    };
    try {
      const value = await evaluator.evaluate(node, childCtx);
      entry.result = value === true ? true : value === false ? false : null;
    } catch (err) {
      entry.result = null;
      entry.error = err.message;
    }
    if (children.length > 0) entry.children = children;
    return entry;
  }
}

module.exports = ConditionRegistry;
