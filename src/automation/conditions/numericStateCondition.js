'use strict';

const { validationError, rejectUnknownFields, requireNonEmptyString } = require('../schema');

const OPERATORS = ['>', '>=', '<', '<=', '==', '!='];

function compare(actual, operator, expected) {
  switch (operator) {
    case '>': return actual > expected;
    case '>=': return actual >= expected;
    case '<': return actual < expected;
    case '<=': return actual <= expected;
    case '==': return actual === expected;
    case '!=': return actual !== expected;
    default: return null;
  }
}

/**
 * Builds a numeric-comparison evaluator for `type` (`temperature`, `humidity`
 * share this helper; registering them as separate types only lets a UI label
 * them differently).
 *
 * Shape: `{ type, deviceId, statusCode, operator, value, scale? }`. The
 * compared number is `reading / 10^scale`. `statusCode` and `scale` are
 * supplied by whoever authored the rule (from the device's real capabilities);
 * the engine has no idea which status code, or which scale, any protocol uses.
 */
function createNumericStateEvaluator(type) {
  return {
    type,

    validate(node, { path }) {
      rejectUnknownFields(node, ['type', 'deviceId', 'statusCode', 'operator', 'value', 'scale'], path);
      const deviceId = requireNonEmptyString(node.deviceId, `${path}.deviceId`);
      const statusCode = requireNonEmptyString(node.statusCode, `${path}.statusCode`);
      if (!OPERATORS.includes(node.operator)) {
        throw validationError(`${path}.operator must be one of: ${OPERATORS.join(', ')}`);
      }
      if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
        throw validationError(`${path}.value must be a finite number`);
      }
      let scale = 0;
      if (node.scale !== undefined) {
        if (!Number.isInteger(node.scale) || node.scale < 0 || node.scale > 6) {
          throw validationError(`${path}.scale must be an integer between 0 and 6`);
        }
        scale = node.scale;
      }
      return { type, deviceId, statusCode, operator: node.operator, value: node.value, scale };
    },

    async evaluate(node, ctx) {
      const status = await ctx.readState(node.deviceId);
      if (!Array.isArray(status)) return null;
      const entry = status.find((s) => s && s.code === node.statusCode);
      if (!entry) return null;
      const raw = entry.value;
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
      const scale = node.scale || 0;
      return compare(raw / 10 ** scale, node.operator, node.value);
    },
  };
}

module.exports = {
  temperatureCondition: createNumericStateEvaluator('temperature'),
  humidityCondition: createNumericStateEvaluator('humidity'),
  createNumericStateEvaluator,
  OPERATORS,
};
