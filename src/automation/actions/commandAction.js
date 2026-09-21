'use strict';

const { validationError, rejectUnknownFields, requireNonEmptyString } = require('../schema');
const { UNCONFIRMED_CODE, resolveVerify, waitForRetry, readMatches } = require('../readBack');

/**
 * `command` action: `{type:'command', deviceId, functionCode, value}` with a
 * boolean `value` (same restriction as the Scene MVP). Runs through the
 * injected device service, then reads the status back and only reports
 * success if the device now shows the requested value ("do not trust the
 * request, trust the read-back"). The read-back is delayed/bounded (see
 * readBack.js) so a cloud propagation delay is reported as `pending`, not as a
 * failure. Kept as a separate implementation so the Scene Engine is untouched.
 *
 * @param {{deviceService: {sendCommand: Function, getDeviceStatus: Function}}} deps
 */
function createCommandAction({ deviceService } = {}) {
  return {
    type: 'command',

    validate(node, { path }) {
      rejectUnknownFields(node, ['type', 'deviceId', 'functionCode', 'value'], path);
      const deviceId = requireNonEmptyString(node.deviceId, `${path}.deviceId`);
      const functionCode = requireNonEmptyString(node.functionCode, `${path}.functionCode`);
      if (typeof node.value !== 'boolean') {
        throw validationError(`${path}.value must be a boolean (only Boolean commands are supported)`);
      }
      return { type: 'command', deviceId, functionCode, value: node.value };
    },

    /**
     * Sends the command exactly once, then confirms it by reading the status
     * back: immediately, and (if that does not show the value yet) once more
     * after a short delay. Outcomes:
     *   - `success`  the read-back shows the requested value;
     *   - `pending`  the command was accepted but the read-back has not shown
     *                the value (yet) - reported with `success:false` and code
     *                UNCONFIRMED, and NOT a failure;
     *   - `failed`   the command itself was rejected / errored.
     * The command is never re-sent.
     */
    async execute(node, ctx) {
      const { deviceId, functionCode, value } = node;
      const base = { deviceId, functionCode, value };
      try {
        await deviceService.sendCommand(deviceId, functionCode, value);
      } catch (err) {
        return {
          ...base,
          status: 'failed',
          success: false,
          error: err.message,
          code: err.appCode || err.code || 'UPSTREAM_ERROR',
        };
      }

      let read = await readMatches(deviceService, deviceId, functionCode, value);
      if (read.matches === true) {
        return { ...base, status: 'success', success: true };
      }

      const verify = resolveVerify(ctx);
      if (await waitForRetry(verify)) {
        read = await readMatches(deviceService, deviceId, functionCode, value);
        if (read.matches === true) {
          return { ...base, status: 'success', success: true, verifiedAfterRetry: true };
        }
      }

      return {
        ...base,
        status: 'pending',
        success: false,
        error:
          read.matches === null
            ? `Command sent, but status could not be read back yet: ${read.error}`
            : 'Command sent, but the device has not confirmed the new value yet',
        code: UNCONFIRMED_CODE,
      };
    },
  };
}

module.exports = createCommandAction;
