'use strict';

/**
 * Protocol-agnostic Device Manager consumed by routes.
 *
 * This is the boundary that keeps routes/ free of any protocol knowledge:
 * it only ever talks to the AdapterRegistry / DeviceAdapter contract, never
 * to a specific SDK (Tuya's or anyone else's) directly. Device records
 * returned by listDevices() are whatever shape each adapter's getDevices()
 * produces (id, nativeId, protocol, name, category, online, and an optional
 * `capabilities`/status-codes field when an adapter provides one) — this
 * class passes them through unchanged rather than reshaping them.
 *
 * Command shape validation ({ code, value }) lives here because it is
 * generic — true for any protocol, not a Tuya-specific rule.
 */
class DeviceService {
  /** @param {import('../adapters/AdapterRegistry')} registry */
  constructor(registry) {
    this.registry = registry;
  }

  /** Aggregates getDevices() across every registered adapter/protocol. */
  async listDevices() {
    const perAdapter = await Promise.all(this.registry.list().map((adapter) => adapter.getDevices()));
    return perAdapter.flat();
  }

  /**
   * Validates the standardized command shape. Throws INVALID_COMMAND (a
   * core error code, not Tuya-specific) if `code` isn't a non-empty string
   * or `value` is missing.
   */
  _validateCommand(code, value) {
    if (typeof code !== 'string' || code.trim() === '') {
      const err = new Error('Command "code" must be a non-empty string');
      err.code = 'INVALID_COMMAND';
      throw err;
    }
    if (value === undefined) {
      const err = new Error('Command "value" is required');
      err.code = 'INVALID_COMMAND';
      throw err;
    }
  }

  /** @param {string} deviceId Namespaced id, e.g. "tuya:1638018234ab950e1ecd" */
  async getDeviceStatus(deviceId) {
    const { nativeId, adapter } = this.registry.resolve(deviceId);
    return adapter.getDeviceStatus(nativeId);
  }

  /**
   * Reports what a device can do (command codes it accepts, status codes it
   * reports), via the owning adapter's getDeviceCapabilities(). Read-only.
   *
   * The identity fields (id / protocol / nativeId) always come from the
   * resolved device id, never from the adapter's own result, so an adapter
   * can't misreport which device a capabilities record belongs to. Every other
   * field is passed through exactly as the adapter produced it. Adapter errors
   * (incl. their `.appCode`) propagate untouched.
   *
   * @param {string} deviceId Namespaced id, e.g. "tuya:1638018234ab950e1ecd"
   */
  async getDeviceCapabilities(deviceId) {
    const { protocol, nativeId, adapter } = this.registry.resolve(deviceId);
    if (typeof adapter.getDeviceCapabilities !== 'function') {
      const err = new Error(`The "${protocol}" adapter does not support capabilities`);
      err.appCode = 'UPSTREAM_ERROR';
      throw err;
    }
    const capabilities = await adapter.getDeviceCapabilities(nativeId);
    const identity = { id: deviceId, protocol, nativeId };
    return Object.assign({}, identity, capabilities, identity);
  }

  /**
   * @param {string} deviceId Namespaced id, e.g. "tuya:1638018234ab950e1ecd"
   * @param {string} code Standardized command code, e.g. "switch_1"
   * @param {*} value Standardized command value, e.g. true
   */
  async sendCommand(deviceId, code, value) {
    this._validateCommand(code, value);
    const { nativeId, adapter } = this.registry.resolve(deviceId);
    return adapter.sendCommand(nativeId, code, value);
  }
}

module.exports = DeviceService;
