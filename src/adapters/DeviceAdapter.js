'use strict';

/**
 * Abstract base class defining the contract every protocol-specific device
 * adapter must implement (Tuya today; Matter, Zigbee, MQTT, IR, RF later).
 *
 * Concrete adapters are the ONLY place protocol-specific detail (signing,
 * wire format, SDKs, transports) is allowed to live. Routes and services
 * must never talk to a protocol SDK directly — only through an adapter
 * instance registered in AdapterRegistry. Adding a new protocol later means
 * writing one new subclass of this class and one registration line in
 * src/bootstrap.js — nothing else in the codebase changes.
 */
class DeviceAdapter {
  /** Unique protocol identifier, e.g. "tuya", "matter", "zigbee", "mqtt", "ir", "rf". */
  get protocol() {
    throw new Error('DeviceAdapter.protocol getter must be implemented by subclass');
  }

  /**
   * Lists the devices this adapter currently knows about.
   * @returns {Promise<Array<{id: string, nativeId: string, protocol: string, name?: string}>>}
   */
  async getDevices() {
    throw new Error(`${this.constructor.name}.getDevices() not implemented`);
  }

  /**
   * Reads the current status of a single device.
   * @param {string} nativeId protocol-native device id (without the "protocol:" prefix)
   */
  async getDeviceStatus(nativeId) {
    throw new Error(`${this.constructor.name}.getDeviceStatus(${nativeId}) not implemented`);
  }

  /**
   * Sends a single command to a device.
   * @param {string} nativeId
   * @param {string} code
   * @param {*} value
   */
  async sendCommand(nativeId, code, value) {
    throw new Error(`${this.constructor.name}.sendCommand(${nativeId}, ${code}, ${value}) not implemented`);
  }
}

module.exports = DeviceAdapter;
