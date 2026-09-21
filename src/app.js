'use strict';

const express = require('express');
const createDevicesRouter = require('./routes/devices');
const createScenesRouter = require('./routes/scenes');
const createAutomationsRouter = require('./routes/automations');
const JsonFileStore = require('./storage/JsonFileStore');
const SceneService = require('./services/sceneService');
const AutomationService = require('./services/automationService');

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
 * @param {import('./services/deviceService')} deviceService
 * @param {{sceneService?: import('./services/sceneService'), automationService?: import('./services/automationService')}} [extra]
 */
function createApp(deviceService, extra = {}) {
  const sceneService = extra.sceneService || new SceneService(new JsonFileStore(), deviceService);
  const automationService = extra.automationService || new AutomationService(new JsonFileStore(), sceneService);

  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/devices', createDevicesRouter(deviceService));
  app.use('/api/scenes', createScenesRouter(sceneService));
  app.use('/api/automations', createAutomationsRouter(automationService));

  // 404 fallback
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Generic error handler (routes catch their own errors; this is a safety net)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

module.exports = createApp;
