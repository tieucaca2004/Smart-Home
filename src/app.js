'use strict';

const express = require('express');
const createDevicesRouter = require('./routes/devices');

/**
 * Builds the Express app.
 *
 * Takes an already-wired DeviceService rather than constructing one itself,
 * so tests can inject a fake service (backed by a fake adapter) with no
 * real network access and no real credentials. The real, live-calling
 * TuyaAdapter is only ever wired in src/bootstrap.js, used by src/server.js.
 *
 * @param {import('./services/deviceService')} deviceService
 */
function createApp(deviceService) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/devices', createDevicesRouter(deviceService));

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
