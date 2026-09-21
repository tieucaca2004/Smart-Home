'use strict';

/**
 * Maps a service-layer error's `.code`/`.appCode` to an HTTP status.
 *
 * Shared by the scenes and automations routers (both new in Sprint 5). The
 * devices router has its own copy (src/routes/devices.js) with the device
 * error taxonomy (DEVICE_OFFLINE, AUTH_ERROR, ...) — that file is frozen, so
 * this one is deliberately separate rather than a shared refactor of it.
 * Execution errors (a scene action failing) are never HTTP errors: they are
 * reported in the 200 response body, since the request itself succeeded.
 */
function statusCodeFor(err) {
  switch (err.code) {
    case 'VALIDATION_ERROR':
    case 'INVALID_COMMAND':
    case 'INVALID_DEVICE_ID':
    case 'UNKNOWN_PROTOCOL':
      return 400;
    case 'SCENE_NOT_FOUND':
    case 'AUTOMATION_NOT_FOUND':
      return 404;
    case 'AUTOMATION_SCHEMA_MISMATCH':
      return 409;
    default:
      return 500;
  }
}

function errorBody(err) {
  return { error: err.message, code: err.code || 'INTERNAL_ERROR' };
}

module.exports = { statusCodeFor, errorBody };
