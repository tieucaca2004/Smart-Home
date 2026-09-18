'use strict';

/**
 * Tuya-specific error classification, kept OUTSIDE TuyaAdapter.js on purpose.
 *
 * TuyaAdapter.js (signing, HTTP calls, success-path behavior) is frozen —
 * it is the already LIVE-TESTED baseline (device discovery, status, ON,
 * OFF, all PASS) and this sprint does not touch it. This module instead
 * WRAPS a TuyaAdapter instance so that, on failure, the error it throws
 * also carries a protocol-agnostic `.appCode` from the app-wide taxonomy:
 *
 *   AUTH_ERROR        — signing/credential/permission problem at Tuya's end
 *   DEVICE_OFFLINE     — Tuya reports the device is offline
 *   DEVICE_NOT_FOUND   — Tuya reports the device doesn't exist / isn't accessible
 *   UPSTREAM_ERROR     — any other adapter/cloud API failure (default)
 *
 * DeviceService and routes/devices.js only ever look at `.appCode` (or the
 * core `.code` for INVALID_DEVICE_ID/UNKNOWN_PROTOCOL/INVALID_COMMAND) —
 * they never see a raw Tuya error code. This keeps Tuya-specific knowledge
 * confined to the Tuya adapter layer, per the Adapter Pattern.
 *
 * The wrapper only touches the CATCH branch of getDeviceStatus/sendCommand.
 * The success path (`return await adapter.method(...)`) is byte-for-byte
 * what calling the real TuyaAdapter directly would do, so this cannot
 * change already-verified successful behavior.
 */

// Tuya error codes actually observed and diagnosed during this project's
// own baseline debugging (see tuya-package / this project's history):
//   1004     — "sign invalid"
//   1106     — "permission deny"
//   40001900 — "No space permission"
// All three are authorization/signing problems from the hub's own
// credentials, not something the API caller can fix — classified as
// AUTH_ERROR. This list is intentionally small and evidence-based; the
// message-pattern checks below catch cases not in this exact list.
const KNOWN_AUTH_ERROR_CODES = new Set([1004, 1106, 40001900]);

const AUTH_MESSAGE_PATTERN =
  /sign invalid|invalid sign|token invalid|token expired|permission deny|no space permission|invalid client_id/;
const OFFLINE_MESSAGE_PATTERN = /offline/;
const NOT_FOUND_MESSAGE_PATTERN = /not exist|not found|does not exist/;

/**
 * Classifies an error thrown by TuyaAdapter into the app-wide taxonomy.
 * Best-effort: based on Tuya codes/messages actually seen in this project,
 * plus generic keyword matching for cases not seen yet. Never inspects or
 * exposes credentials — only the error's existing `.code` (Tuya's numeric
 * code) and `.message` (Tuya's `msg` text, which never contains the secret).
 *
 * @param {Error} err
 * @returns {'AUTH_ERROR'|'DEVICE_OFFLINE'|'DEVICE_NOT_FOUND'|'UPSTREAM_ERROR'}
 */
function classifyTuyaError(err) {
  const tuyaCode = err && err.code;
  const msg = String((err && err.message) || '').toLowerCase();

  if (KNOWN_AUTH_ERROR_CODES.has(tuyaCode) || AUTH_MESSAGE_PATTERN.test(msg)) {
    return 'AUTH_ERROR';
  }
  if (OFFLINE_MESSAGE_PATTERN.test(msg)) {
    return 'DEVICE_OFFLINE';
  }
  if (NOT_FOUND_MESSAGE_PATTERN.test(msg)) {
    return 'DEVICE_NOT_FOUND';
  }
  return 'UPSTREAM_ERROR';
}

/**
 * Wraps a DeviceAdapter-shaped instance (in practice, a TuyaAdapter) so
 * getDeviceStatus()/sendCommand() failures carry a normalized `.appCode`.
 * getDevices() is passed through unchanged — it already captures per-device
 * errors internally (see TuyaAdapter.getDevices) rather than throwing.
 *
 * Does not mutate or subclass the adapter; does not change its signing,
 * HTTP calls, or success-path return values in any way.
 *
 * @param {import('../DeviceAdapter')} adapter
 */
function wrapWithErrorNormalization(adapter) {
  return {
    protocol: adapter.protocol,

    async getDevices(...args) {
      return adapter.getDevices(...args);
    },

    async getDeviceStatus(...args) {
      try {
        return await adapter.getDeviceStatus(...args);
      } catch (err) {
        if (!err.appCode) err.appCode = classifyTuyaError(err);
        throw err;
      }
    },

    async sendCommand(...args) {
      try {
        return await adapter.sendCommand(...args);
      } catch (err) {
        if (!err.appCode) err.appCode = classifyTuyaError(err);
        throw err;
      }
    },
  };
}

module.exports = { classifyTuyaError, wrapWithErrorNormalization };
