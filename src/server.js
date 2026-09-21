'use strict';

const createApp = require('./app');
const { buildDeviceService, buildScenesAndAutomations } = require('./bootstrap');

const PORT = process.env.PORT || 3000;

const deviceService = buildDeviceService(); // throws immediately if Tuya credentials are missing
const { sceneService, automationService, scheduler } = buildScenesAndAutomations(deviceService);
const app = createApp(deviceService, { sceneService, automationService });

scheduler.start();

app.listen(PORT, () => {
  console.log(`tieu-home-hub listening on port ${PORT}`);
});
