'use strict';

const createApp = require('./app');
const { buildDeviceService } = require('./bootstrap');

const PORT = process.env.PORT || 3000;

const deviceService = buildDeviceService(); // throws immediately if Tuya credentials are missing
const app = createApp(deviceService);

app.listen(PORT, () => {
  console.log(`tieu-home-hub listening on port ${PORT}`);
});
