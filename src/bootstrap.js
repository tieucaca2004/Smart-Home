'use strict';

const path = require('path');
const AdapterRegistry = require('./adapters/AdapterRegistry');
const TuyaDiscoveryAdapter = require('./adapters/tuya/TuyaDiscoveryAdapter');
const { wrapWithErrorNormalization } = require('./adapters/tuya/normalizeTuyaErrors');
const { withDeviceTimeout, readDeviceTimeoutOptions } = require('./adapters/withDeviceTimeout');
const DeviceService = require('./services/deviceService');
const JsonFileStore = require('./storage/JsonFileStore');
const SceneService = require('./services/sceneService');
const AutomationService = require('./services/automationService');
const AutomationScheduler = require('./services/AutomationScheduler');
const RuleEngine = require('./automation/RuleEngine');
const createDefaultRegistries = require('./automation/createDefaultRegistries');

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
 * withDeviceTimeout() wraps that from the outside (protocol-neutral, TuyaAdapter
 * unchanged) so a hung device call is abandoned with a DEVICE_TIMEOUT error
 * instead of blocking the scheduler; HUB_DEVICE_TIMEOUT_MS / HUB_DEVICE_LIST_TIMEOUT_MS tune it.
 *
 * To add a new protocol later (Matter, Zigbee, MQTT, IR, RF, ...): write a
 * new class extending DeviceAdapter, then add one `registry.register(...)`
 * line here. No other file in the codebase needs to change.
 */
function buildDeviceService() {
  const registry = new AdapterRegistry();

  // TuyaDiscoveryAdapter = the frozen TuyaAdapter + listing every device the Tuya
  // Cloud project can see (TUYA_DISCOVERY=off restores the TUYA_DEVICE_IDS-only list).
  registry.register(withDeviceTimeout(wrapWithErrorNormalization(new TuyaDiscoveryAdapter()), readDeviceTimeoutOptions()));
  // Future: registry.register(new MatterAdapter());
  // Future: registry.register(new ZigbeeAdapter());
  // Future: registry.register(new MqttAdapter());
  // Future: registry.register(new IrAdapter());
  // Future: registry.register(new RfAdapter());

  return new DeviceService(registry);
}

/**
 * Reads the Hub's location (used only by sunrise/sunset conditions) from
 * `HUB_LATITUDE` / `HUB_LONGITUDE` (decimal degrees). Returns
 * `{latitude, longitude}`, or `null` if unset or invalid (with a warning for a
 * half-set or invalid pair). A missing location never stops the Hub; it only
 * means rules with a `sun` condition are rejected.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Console} [log]
 * @returns {{latitude: number, longitude: number}|null}
 */
function readHubLocation(env = process.env, log = console) {
  const rawLat = typeof env.HUB_LATITUDE === 'string' ? env.HUB_LATITUDE.trim() : '';
  const rawLon = typeof env.HUB_LONGITUDE === 'string' ? env.HUB_LONGITUDE.trim() : '';
  if (rawLat === '' && rawLon === '') return null;
  if (rawLat === '' || rawLon === '') {
    log.warn('[hub] Only one of HUB_LATITUDE / HUB_LONGITUDE is set; sunrise/sunset conditions are disabled.');
    return null;
  }
  const latitude = Number(rawLat);
  const longitude = Number(rawLon);
  const valid =
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  if (!valid) {
    log.warn('[hub] HUB_LATITUDE / HUB_LONGITUDE are not valid coordinates; sunrise/sunset conditions are disabled.');
    return null;
  }
  return { latitude, longitude };
}

/**
 * Wires the real, file-backed Scene and Automation services (Sprint 5),
 * plus the scheduler that evaluates "daily" automation triggers and, since
 * Sprint 6, IF -> THEN rules through a RuleEngine.
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
  const location = readHubLocation();
  const registries = createDefaultRegistries({ deviceService, sceneService });
  const automationService = new AutomationService(
    new JsonFileStore(path.join(DATA_DIR, 'automations.json')),
    sceneService,
    { ...registries, location }
  );
  const ruleEngine = new RuleEngine({ deviceService, ...registries, location });
  const scheduler = new AutomationScheduler(automationService, sceneService, { ruleEngine });
  return { sceneService, automationService, scheduler, ruleEngine, location };
}

module.exports = { buildDeviceService, buildScenesAndAutomations, readHubLocation };
