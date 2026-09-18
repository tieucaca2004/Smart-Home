'use strict';

const AdapterRegistry = require('./adapters/AdapterRegistry');
const TuyaAdapter = require('./adapters/tuya/TuyaAdapter');
const { wrapWithErrorNormalization } = require('./adapters/tuya/normalizeTuyaErrors');
const DeviceService = require('./services/deviceService');

/**
 * Wires the real adapters for actual (non-test) use.
 *
 * TuyaAdapter itself is untouched (frozen, already live-tested baseline).
 * It is wrapped with wrapWithErrorNormalization() purely so failures carry
 * a standardized `.appCode` (AUTH_ERROR / DEVICE_OFFLINE / DEVICE_NOT_FOUND
 * / UPSTREAM_ERROR) for routes to map to HTTP status codes — the wrapper
 * only touches the catch branch, so successful calls behave identically to
 * calling TuyaAdapter directly.
 *
 * To add a new protocol later (Matter, Zigbee, MQTT, IR, RF, ...): write a
 * new class extending DeviceAdapter, then add one `registry.register(...)`
 * line here. No other file in the codebase needs to change.
 */
function buildDeviceService() {
  const registry = new AdapterRegistry();

  registry.register(wrapWithErrorNormalization(new TuyaAdapter()));
  // Future: registry.register(new MatterAdapter());
  // Future: registry.register(new ZigbeeAdapter());
  // Future: registry.register(new MqttAdapter());
  // Future: registry.register(new IrAdapter());
  // Future: registry.register(new RfAdapter());

  return new DeviceService(registry);
}

module.exports = { buildDeviceService };
