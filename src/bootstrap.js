'use strict';

const path = require('path');
const AdapterRegistry = require('./adapters/AdapterRegistry');
const TuyaDiscoveryAdapter = require('./adapters/tuya/TuyaDiscoveryAdapter');
const { wrapWithErrorNormalization } = require('./adapters/tuya/normalizeTuyaErrors');
const DeviceService = require('./services/deviceService');
const JsonFileStore = require('./storage/JsonFileStore');
const SceneService = require('./services/sceneService');
const AutomationService = require('./services/automationService');
const AutomationScheduler = require('./services/AutomationScheduler');

/** Where Scene/Automation records live: one JSON file each, next to the repo. */
const DATA_DIR = path.join(__dirname, '..', 'data');

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

  // TuyaDiscoveryAdapter = the frozen TuyaAdapter + listing every device the Tuya
  // Cloud project can see (TUYA_DISCOVERY=off restores the TUYA_DEVICE_IDS-only list).
  registry.register(wrapWithErrorNormalization(new TuyaDiscoveryAdapter()));
  // Future: registry.register(new MatterAdapter());
  // Future: registry.register(new ZigbeeAdapter());
  // Future: registry.register(new MqttAdapter());
  // Future: registry.register(new IrAdapter());
  // Future: registry.register(new RfAdapter());

  return new DeviceService(registry);
}

/**
 * Wires the real, file-backed Scene and Automation services (Sprint 5),
 * plus the scheduler that evaluates "daily" automation triggers.
 *
 * Persistence is two JSON files under data/ — no database server, matching
 * the rest of this project (Tuya itself is the device state; the Hub has
 * never needed a DB). Scene/Automation records are small and few (a home's
 * worth), so a JSON file read-on-load, written-on-mutation is enough.
 *
 * @param {DeviceService} deviceService
 */
function buildScenesAndAutomations(deviceService) {
  const sceneService = new SceneService(new JsonFileStore(path.join(DATA_DIR, 'scenes.json')), deviceService);
  const automationService = new AutomationService(
    new JsonFileStore(path.join(DATA_DIR, 'automations.json')),
    sceneService
  );
  const scheduler = new AutomationScheduler(automationService, sceneService);
  return { sceneService, automationService, scheduler };
}

module.exports = { buildDeviceService, buildScenesAndAutomations };
