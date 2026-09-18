'use strict';

/**
 * Central registry mapping a protocol name ("tuya", "matter", "zigbee", ...)
 * to its adapter instance.
 *
 * Device IDs used throughout the public API are namespaced as
 * "<protocol>:<nativeId>", e.g. "tuya:1638018234ab950e1ecd", so requests
 * can be routed to the right adapter without any extra lookup table.
 */
class AdapterRegistry {
  constructor() {
    this._adapters = new Map();
  }

  /** @param {import('./DeviceAdapter')} adapter */
  register(adapter) {
    if (!adapter || typeof adapter.protocol !== 'string' || !adapter.protocol) {
      throw new Error('register() requires an adapter instance with a non-empty .protocol');
    }
    this._adapters.set(adapter.protocol, adapter);
    return this;
  }

  has(protocol) {
    return this._adapters.has(protocol);
  }

  get(protocol) {
    const adapter = this._adapters.get(protocol);
    if (!adapter) {
      const err = new Error(`No adapter registered for protocol "${protocol}"`);
      err.code = 'UNKNOWN_PROTOCOL';
      throw err;
    }
    return adapter;
  }

  list() {
    return Array.from(this._adapters.values());
  }

  /**
   * Splits a namespaced device id ("tuya:abc123") into { protocol, nativeId }.
   * Throws INVALID_DEVICE_ID if the id has no "<protocol>:" prefix, or if
   * either half is empty (e.g. "tuya:", ":abc123").
   */
  static parseDeviceId(deviceId) {
    const invalid = () => {
      const err = new Error(
        `Invalid device id "${deviceId}": expected format "<protocol>:<nativeId>" ` +
          '(e.g. "tuya:1638018234ab950e1ecd")'
      );
      err.code = 'INVALID_DEVICE_ID';
      return err;
    };
    if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
      throw invalid();
    }
    const idx = deviceId.indexOf(':');
    const protocol = deviceId.slice(0, idx);
    const nativeId = deviceId.slice(idx + 1);
    if (!protocol || !nativeId) {
      throw invalid();
    }
    return { protocol, nativeId };
  }

  /**
   * Convenience helper combining parseDeviceId() + get(): resolves a
   * namespaced device id straight to its adapter. Throws INVALID_DEVICE_ID
   * or UNKNOWN_PROTOCOL exactly as the two underlying calls would.
   * @returns {{protocol: string, nativeId: string, adapter: import('./DeviceAdapter')}}
   */
  resolve(deviceId) {
    const { protocol, nativeId } = AdapterRegistry.parseDeviceId(deviceId);
    const adapter = this.get(protocol);
    return { protocol, nativeId, adapter };
  }
}

module.exports = AdapterRegistry;
