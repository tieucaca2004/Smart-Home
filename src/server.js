'use strict';

const createApp = require('./app');
const { buildDeviceService, buildScenesAndAutomations } = require('./bootstrap');

const PORT = process.env.PORT || 3000;
// Optional (Round C / F-04). Unset -> app.listen(PORT, cb) exactly as before
// (binds all interfaces). Set -> passed through as the bind host.
const HUB_HOST = process.env.HUB_HOST;
// Optional (Round C / F-04). Unset -> no auth required on /api/*, exactly as
// before. Set -> /api/* requires "Authorization: Bearer <HUB_API_TOKEN>".
const HUB_API_TOKEN = process.env.HUB_API_TOKEN;

const deviceService = buildDeviceService(); // throws immediately if Tuya credentials are missing
const { sceneService, automationService, scheduler, ruleEngine, location } = buildScenesAndAutomations(deviceService);
const app = createApp(deviceService, { sceneService, automationService, ruleEngine, location, hubApiToken: HUB_API_TOKEN });

scheduler.start();

const listenCallback = () => {
  console.log(`tieu-home-hub listening on port ${PORT}`);
};

if (HUB_HOST) {
  app.listen(PORT, HUB_HOST, listenCallback);
} else {
  app.listen(PORT, listenCallback);
}
