'use strict';

const { validationError, rejectUnknownFields, requireNonEmptyString } = require('../schema');

/**
 * Builds an equality evaluator for `type` (`device_state`, `motion`, `door`
 * share this helper; separate types are for labelling only).
 *
 * Shape: `{ type, deviceId, statusCode, equals }` where `equals` is a boolean,
 * finite number or string, compared with `===` to the value the device
 * reports for `statusCode`. What `equals` means ("door open", "motion
 * detected") differs per device/protocol, so the rule author supplies it; the
 * engine never guesses.
 */
function createDeviceStateEvaluator(type) {
  return {
    type,

    validate(node, { path }) {
      rejectUnknownFields(node, ['type', 'deviceId', 'statusCode', 'equals'], path);
      const deviceId = requireNonEmptyString(node.deviceId, `${path}.deviceId`);
      const statusCode = requireNonEmptyString(node.statusCode, `${path}.statusCode`);
      const eq = node.equals;
      const okType =
        typeof eq === 'boolean' || typeof eq === 'string' || (typeof eq === 'number' && Number.isFinite(eq));
      if (!okType) {
        throw validationError(`${path}.equals must be a boolean, a finite number or a string`);
      }
      return { type, deviceId, statusCode, equals: eq };
    },

    async evaluate(node, ctx) {
      const status = await ctx.readState(node.deviceId);
      if (!Array.isArray(status)) return null;
      const entry = status.find((s) => s && s.code === node.statusCode);
      if (!entry || entry.value === undefined || entry.value === null) return null;
      return entry.value === node.equals;
    },
  };
}

module.exports = {
  deviceStateCondition: createDeviceStateEvaluator('device_state'),
  motionCondition: createDeviceStateEvaluator('motion'),
  doorCondition: createDeviceStateEvaluator('door'),
  createDeviceStateEvaluator,
};
