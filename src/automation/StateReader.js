'use strict';

/**
 * The only way the rule engine reads a device's state: through the injected
 * device service's `getDeviceStatus(deviceId)` (which returns
 * `[{code, value}]`). Cached for the lifetime of one reader (= one scheduler
 * tick), so however many rules mention a device, it is read at most once per
 * tick.
 *
 * Any failure (offline, unknown device, adapter without status support, a
 * malformed reply) yields `null` = "unknown" — never an exception and never a
 * made-up value.
 */
class StateReader {
  /** @param {{getDeviceStatus: (deviceId: string) => Promise<Array<{code: string, value: *}>>}} deviceService */
  constructor(deviceService) {
    this.deviceService = deviceService;
    this._cache = new Map(); // deviceId -> Promise<Array|null>
  }

  /** @returns {Promise<Array<{code: string, value: *}>|null>} */
  read(deviceId) {
    if (!this._cache.has(deviceId)) {
      this._cache.set(deviceId, this._fetch(deviceId));
    }
    return this._cache.get(deviceId);
  }

  async _fetch(deviceId) {
    try {
      const status = await this.deviceService.getDeviceStatus(deviceId);
      return Array.isArray(status) ? status : null;
    } catch (err) {
      return null;
    }
  }

  /** Drops the cache, e.g. after actions changed device state within the same tick. */
  clear() {
    this._cache.clear();
  }
}

module.exports = StateReader;
