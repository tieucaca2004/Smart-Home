'use strict';

const express = require('express');
const createDevicesRouter = require('./routes/devices');
const createScenesRouter = require('./routes/scenes');
const createAutomationsRouter = require('./routes/automations');
const JsonFileStore = require('./storage/JsonFileStore');
const SceneService = require('./services/sceneService');
const AutomationService = require('./services/automationService');
const RuleEngine = require('./automation/RuleEngine');
const createDefaultRegistries = require('./automation/createDefaultRegistries');

/**
 * Builds the Express app.
 *
 * Takes an already-wired DeviceService rather than constructing one itself,
 * so tests can inject a fake service (backed by a fake adapter) with no
 * real network access and no real credentials. The real, live-calling
 * TuyaAdapter is only ever wired in src/bootstrap.js, used by src/server.js.
 *
 * `sceneService`/`automationService` (Sprint 5) are optional and default to
 * fresh, in-memory-only instances built on top of `deviceService`, so every
 * existing call site (`createApp(deviceService)`) keeps working unchanged —
 * real, file-backed instances are only ever wired in src/bootstrap.js.
 *
 * `ruleEngine` (Sprint 6) follows the same rule: optional, defaulting to an
 * engine built on `deviceService` and the built-in condition/action registries
 * (only the POST /api/automations/:id/evaluate dry run uses it here; the real,
 * scheduler-driven engine is wired in src/bootstrap.js).
 *
 * @param {import('./services/deviceService')} deviceService
 * @param {{sceneService?: import('./services/sceneService'), automationService?: import('./services/automationService'), ruleEngine?: import('./automation/RuleEngine'), location?: ({latitude:number, longitude:number}|null)}} [extra]
 */
function createApp(deviceService, extra = {}) {
  const sceneService = extra.sceneService || new SceneService(new JsonFileStore(), deviceService);
  const registries = createDefaultRegistries({ deviceService, sceneService });
  const location = extra.location || null;
  const automationService =
    extra.automationService || new AutomationService(new JsonFileStore(), sceneService, { ...registries, location });
  const ruleEngine = extra.ruleEngine || new RuleEngine({ deviceService, ...registries, location });

  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/devices', createDevicesRouter(deviceService));
  app.use('/api/scenes', createScenesRouter(sceneService));
  app.use('/api/automations', createAutomationsRouter(automationService, { ruleEngine }));

  // 404 fallback
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Generic error handler (routes catch their own errors; this is a safety net)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // express.json() failures never reach a route's own try/catch. Answer them with
    // fixed texts only: no parser message, stack, path or echo of the request body.
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body is not valid JSON', code: 'INVALID_JSON' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' });
    }
    res.status(500).json({ error: err.message });
  });

  return app;
}

module.exports = createApp;
