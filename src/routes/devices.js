'use strict';

const express = require('express');

/**
 * Maps a service/adapter-layer error to an HTTP status code.
 *
 * Checks `.appCode` first (set by a protocol adapter's error normalizer,
 * e.g. src/adapters/tuya/normalizeTuyaErrors.js) and falls back to `.code`
 * (set directly by core/DeviceService for request-shape problems). This
 * function itself has no protocol-specific knowledge — it only knows the
 * app-wide taxonomy.
 */
function statusCodeFor(err) {
  const taxonomyCode = err.appCode || err.code;
  switch (taxonomyCode) {
    case 'INVALID_DEVICE_ID':
    case 'UNKNOWN_PROTOCOL':
    case 'INVALID_COMMAND':
      return 400;
    case 'DEVICE_NOT_FOUND':
      return 404;
    case 'DEVICE_OFFLINE':
      return 409; // device exists but can't accept the request in its current state
    case 'AUTH_ERROR':
      return 500; // the hub's own credential/signing problem, not the caller's fault
    case 'UPSTREAM_ERROR':
    default:
      return 502; // upstream (protocol adapter / cloud API) failure
  }
}

/** Error response body — never includes the raw taxonomy-less Tuya code, and never a credential. */
function errorBody(err, id) {
  const body = { error: err.message, code: err.appCode || err.code };
  if (id !== undefined) body.id = id;
  return body;
}

/**
 * Builds the /api/devices router.
 * @param {import('../services/deviceService')} deviceService
 */
function createDevicesRouter(deviceService) {
  const router = express.Router();

  // GET /api/devices
  router.get('/', async (req, res) => {
    try {
      const devices = await deviceService.listDevices();
      res.json({ devices });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/devices/:id/status
  router.get('/:id/status', async (req, res) => {
    try {
      const status = await deviceService.getDeviceStatus(req.params.id);
      res.json({ id: req.params.id, status });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err, req.params.id));
    }
  });

  // GET /api/devices/:id/capabilities — what the device can do (read-only)
  router.get('/:id/capabilities', async (req, res) => {
    try {
      const capabilities = await deviceService.getDeviceCapabilities(req.params.id);
      res.json({ id: req.params.id, capabilities });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err, req.params.id));
    }
  });

  // POST /api/devices/:id/commands   body: { code, value }
  // Command shape validation ({ code, value }) is centralized in
  // DeviceService.sendCommand (INVALID_COMMAND) — generic, not Tuya-specific
  // — so it applies no matter which protocol adapter ends up handling it.
  router.post('/:id/commands', async (req, res) => {
    const { code, value } = req.body || {};
    try {
      const result = await deviceService.sendCommand(req.params.id, code, value);
      res.json({ id: req.params.id, code, value, result });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err, req.params.id));
    }
  });

  return router;
}

module.exports = createDevicesRouter;
