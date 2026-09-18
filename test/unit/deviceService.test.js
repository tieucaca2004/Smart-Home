'use strict';

/**
 * Unit tests for DeviceService (the protocol-agnostic Device Manager).
 * Uses AdapterRegistry with simple in-file stub adapters — no network, no
 * real Tuya credentials, no dependency on TuyaAdapter at all.
 */

const assert = require('assert');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceService = require('../../src/services/deviceService');

function makeStubAdapter(protocol, devices, { statusByNativeId = {}, failNativeIds = {} } = {}) {
  return {
    protocol,
    async getDevices() {
      return devices;
    },
    async getDeviceStatus(nativeId) {
      if (failNativeIds[nativeId]) throw failNativeIds[nativeId];
      return statusByNativeId[nativeId] || [];
    },
    async sendCommand(nativeId, code, value) {
      if (failNativeIds[nativeId]) throw failNativeIds[nativeId];
      return { nativeId, code, value, accepted: true };
    },
  };
}

let passCount = 0;
let failCount = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
    passCount += 1;
  } catch (err) {
    console.log(`  ✘ ${name}`);
    console.log(`      ${err.message}`);
    failCount += 1;
  }
}

async function run() {
  console.log('=== DeviceService unit tests ===\n');

  await check('listDevices() aggregates multiple devices from a single adapter', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      makeStubAdapter('tuya', [
        { id: 'tuya:dev1', nativeId: 'dev1', protocol: 'tuya', name: 'Đèn Quán Quầy', online: true },
        { id: 'tuya:dev2', nativeId: 'dev2', protocol: 'tuya', name: 'Đèn quán Ăn', online: true },
      ])
    );
    const service = new DeviceService(registry);
    const devices = await service.listDevices();
    assert.strictEqual(devices.length, 2);
    assert.deepStrictEqual(
      devices.map((d) => d.id),
      ['tuya:dev1', 'tuya:dev2']
    );
  });

  await check('listDevices() aggregates devices across multiple protocol adapters', async () => {
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya', [{ id: 'tuya:dev1', nativeId: 'dev1', protocol: 'tuya' }]));
    registry.register(makeStubAdapter('mqtt', [{ id: 'mqtt:sensor1', nativeId: 'sensor1', protocol: 'mqtt' }]));
    const service = new DeviceService(registry);
    const devices = await service.listDevices();
    assert.strictEqual(devices.length, 2);
    const ids = devices.map((d) => d.id).sort();
    assert.deepStrictEqual(ids, ['mqtt:sensor1', 'tuya:dev1']);
  });

  await check('listDevices() passes through an optional capabilities field untouched', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      makeStubAdapter('tuya', [
        { id: 'tuya:dev1', nativeId: 'dev1', protocol: 'tuya', capabilities: ['switch_1'] },
      ])
    );
    const service = new DeviceService(registry);
    const devices = await service.listDevices();
    assert.deepStrictEqual(devices[0].capabilities, ['switch_1']);
  });

  await check('getDeviceStatus() looks up the correct device among several', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      makeStubAdapter(
        'tuya',
        [
          { id: 'tuya:dev1', nativeId: 'dev1', protocol: 'tuya' },
          { id: 'tuya:dev2', nativeId: 'dev2', protocol: 'tuya' },
        ],
        { statusByNativeId: { dev2: [{ code: 'switch_1', value: true }] } }
      )
    );
    const service = new DeviceService(registry);
    const status = await service.getDeviceStatus('tuya:dev2');
    assert.deepStrictEqual(status, [{ code: 'switch_1', value: true }]);
  });

  await check('sendCommand() routes to the correct device among several (not just the first)', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      makeStubAdapter('tuya', [
        { id: 'tuya:dev1', nativeId: 'dev1', protocol: 'tuya' },
        { id: 'tuya:dev2', nativeId: 'dev2', protocol: 'tuya' },
      ])
    );
    const service = new DeviceService(registry);
    const result = await service.sendCommand('tuya:dev2', 'switch_1', true);
    assert.strictEqual(result.nativeId, 'dev2');
    assert.strictEqual(result.code, 'switch_1');
    assert.strictEqual(result.value, true);
  });

  await check('getDeviceStatus() with an unknown protocol throws UNKNOWN_PROTOCOL', async () => {
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya', []));
    const service = new DeviceService(registry);
    await assert.rejects(
      () => service.getDeviceStatus('matter:xyz'),
      (err) => err.code === 'UNKNOWN_PROTOCOL'
    );
  });

  await check('getDeviceStatus() with a malformed id throws INVALID_DEVICE_ID', async () => {
    const registry = new AdapterRegistry();
    const service = new DeviceService(registry);
    await assert.rejects(
      () => service.getDeviceStatus('no-prefix'),
      (err) => err.code === 'INVALID_DEVICE_ID'
    );
  });

  await check('sendCommand() rejects a missing code with INVALID_COMMAND, before touching the adapter', async () => {
    const registry = new AdapterRegistry();
    let adapterCalled = false;
    registry.register({
      protocol: 'tuya',
      async getDevices() {
        return [];
      },
      async getDeviceStatus() {
        return [];
      },
      async sendCommand() {
        adapterCalled = true;
        return true;
      },
    });
    const service = new DeviceService(registry);
    await assert.rejects(
      () => service.sendCommand('tuya:dev1', undefined, true),
      (err) => err.code === 'INVALID_COMMAND'
    );
    assert.strictEqual(adapterCalled, false);
  });

  await check('sendCommand() rejects an empty-string code with INVALID_COMMAND', async () => {
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya', []));
    const service = new DeviceService(registry);
    await assert.rejects(
      () => service.sendCommand('tuya:dev1', '   ', true),
      (err) => err.code === 'INVALID_COMMAND'
    );
  });

  await check('sendCommand() rejects a missing value with INVALID_COMMAND', async () => {
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya', []));
    const service = new DeviceService(registry);
    await assert.rejects(
      () => service.sendCommand('tuya:dev1', 'switch_1', undefined),
      (err) => err.code === 'INVALID_COMMAND'
    );
  });

  await check('sendCommand() accepts value: false (not treated as missing)', async () => {
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya', []));
    const service = new DeviceService(registry);
    const result = await service.sendCommand('tuya:dev1', 'switch_1', false);
    assert.strictEqual(result.value, false);
  });

  await check('getDeviceStatus() propagates an adapter-level error (e.g. AUTH_ERROR) untouched', async () => {
    const authErr = new Error('Tuya API error: code=1004 msg=sign invalid');
    authErr.appCode = 'AUTH_ERROR';
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya', [], { failNativeIds: { dev1: authErr } }));
    const service = new DeviceService(registry);
    await assert.rejects(
      () => service.getDeviceStatus('tuya:dev1'),
      (err) => err.appCode === 'AUTH_ERROR' && err.message === authErr.message
    );
  });

  await check('sendCommand() propagates an adapter-level DEVICE_OFFLINE error untouched', async () => {
    const offlineErr = new Error('device is offline');
    offlineErr.appCode = 'DEVICE_OFFLINE';
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya', [], { failNativeIds: { dev1: offlineErr } }));
    const service = new DeviceService(registry);
    await assert.rejects(
      () => service.sendCommand('tuya:dev1', 'switch_1', true),
      (err) => err.appCode === 'DEVICE_OFFLINE'
    );
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
