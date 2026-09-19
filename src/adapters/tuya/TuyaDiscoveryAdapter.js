'use strict';

const TuyaAdapter = require('./TuyaAdapter');

/**
 * Tuya "Batch query for the list of associated App user dimension devices":
 * every device of every App account linked to the Cloud project, paged.
 * Needs no uid / space id in the request (the project's linked accounts are
 * implied by the token), which is why it can list "everything the project
 * can see" from a single call.
 *   GET /v1.0/iot-01/associated-users/devices?last_row_key=...&size=...
 *   result: { devices: [...], has_more, last_row_key, total }
 *
 * Query parameters are appended in alphabetical order because Tuya signs the
 * request URL including its query string, in that order (TuyaAdapter signs the
 * exact path it is given).
 */
const DISCOVERY_PATH = '/v1.0/iot-01/associated-users/devices';
const PAGE_SIZE = 50;
/** Upper bound on pages (50 x 20 = 1000 devices) so a misbehaving cursor can never loop forever. */
const MAX_PAGES = 20;

function isDiscoveryEnabled(options) {
  if (options.discover !== undefined) return Boolean(options.discover);
  return !/^(off|false|0|no)$/i.test((process.env.TUYA_DISCOVERY || '').trim());
}

/**
 * Turns one raw Tuya device into the Hub's device record — the same shape
 * TuyaAdapter.getDevices() produces: { id, nativeId, protocol, name, category, online }.
 *
 * It is an explicit WHITELIST. Tuya's raw device object carries secrets and
 * private data (`local_key`, `ip`, `uid`, coordinates, ...); none of that may
 * reach a Hub response, so nothing is copied except the fields named here.
 * Returns null for an entry without a usable id.
 */
function toDeviceRecord(protocol, raw) {
  if (!raw || typeof raw.id !== 'string' || raw.id === '') return null;
  const record = { id: `${protocol}:${raw.id}`, nativeId: raw.id, protocol };
  if (typeof raw.name === 'string' && raw.name) record.name = raw.name;
  if (typeof raw.category === 'string' && raw.category) record.category = raw.category;
  const online = typeof raw.online === 'boolean' ? raw.online : raw.is_online;
  if (typeof online === 'boolean') record.online = online;
  return record;
}

/**
 * The configured devices (TUYA_DEVICE_IDS) come first and keep the record
 * TuyaAdapter built for them — unless that lookup failed and discovery found
 * the same device, in which case the working record is more useful. Devices
 * only discovery found are appended in the order Tuya returned them.
 */
function mergeDevices(configured, discovered) {
  const discoveredById = new Map(discovered.map((device) => [device.id, device]));
  const merged = configured.map((device) =>
    device.error && discoveredById.has(device.id) ? discoveredById.get(device.id) : device
  );
  const present = new Set(merged.map((device) => device.id));
  for (const device of discovered) {
    if (!present.has(device.id)) merged.push(device);
  }
  return merged;
}

/**
 * TuyaAdapter + real device discovery.
 *
 * TuyaAdapter itself is untouched (frozen, live-tested baseline). This subclass
 * only overrides getDevices(): it takes what TuyaAdapter returns for the ids
 * configured in TUYA_DEVICE_IDS and adds every other device the Cloud project
 * can see. Status, capabilities and commands are inherited unchanged.
 *
 * Discovery is best-effort and read-only (GET only). If Tuya refuses the call
 * (for example the project is not subscribed to the API that serves it), the
 * failure is logged on the Hub and `lastDiscoveryError` is set, and
 * getDevices() returns exactly what it returned before discovery existed — the
 * configured devices — so the Hub never gets worse than it was.
 *
 * Turn it off with TUYA_DISCOVERY=off (or the `discover: false` option).
 */
class TuyaDiscoveryAdapter extends TuyaAdapter {
  /**
   * @param {Object} [options] Everything TuyaAdapter accepts, plus:
   * @param {boolean} [options.discover] Overrides the TUYA_DISCOVERY env var (default: on).
   */
  constructor(options = {}) {
    super(options);
    this.discoveryEnabled = isDiscoveryEnabled(options);
    /** Why the last discovery attempt failed; null when it succeeded or has not run. */
    this.lastDiscoveryError = null;
  }

  /** Every device the Cloud project can see, as Hub device records. Throws if Tuya refuses. */
  async discoverDevices() {
    const found = [];
    const seen = new Set();
    let lastRowKey;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = lastRowKey
        ? `?last_row_key=${encodeURIComponent(lastRowKey)}&size=${PAGE_SIZE}`
        : `?size=${PAGE_SIZE}`;
      const result = await this._call('GET', DISCOVERY_PATH + query);

      const rawDevices = result && Array.isArray(result.devices) ? result.devices : [];
      for (const raw of rawDevices) {
        const record = toDeviceRecord(this.protocol, raw);
        if (record && !seen.has(record.id)) {
          seen.add(record.id);
          found.push(record);
        }
      }

      const next = result && result.last_row_key;
      if (!result || result.has_more !== true || !next || next === lastRowKey) return found;
      lastRowKey = next;
    }

    console.warn(`Tuya discovery stopped after ${MAX_PAGES} pages; the device list may be incomplete.`);
    return found;
  }

  async getDevices() {
    const configured = await super.getDevices();
    if (!this.discoveryEnabled) return configured;

    let discovered;
    try {
      discovered = await this.discoverDevices();
      this.lastDiscoveryError = null;
    } catch (err) {
      this.lastDiscoveryError = err.message;
      console.warn(`Tuya device discovery failed; listing configured devices only. ${err.message}`);
      return configured;
    }
    return mergeDevices(configured, discovered);
  }
}

module.exports = TuyaDiscoveryAdapter;
module.exports.toDeviceRecord = toDeviceRecord;
module.exports.mergeDevices = mergeDevices;
