'use strict';

/**
 * Unit tests for DeviceService.getDeviceCapabilities() and the DeviceAdapter
 * base-class contract for getDeviceCapabilities(). Stub adapters only — no
 * network, no credentials, no dependency on TuyaAdapter.
 */

const assert = require('assert');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceAdapter = require('../../src/adapters/DeviceAdapter');
const DeviceService = require('../../src/services/deviceService');

function makeStubAdapter(protocol, { capsByNativeId = {}, failNativeIds = {} } = {}) {
  const calls = [];
  return {
    protocol,
    calls,
    async getDevices() {
      return [];
    },
    async getDeviceStatus() {
      return [];
    },
    async sendCommand() {
      return true;
    },
    async getDeviceCapabilities(nativeId) {
      calls.push(nativeId);
      if (failNativeIds[nativeId]) throw failNativeIds[nativeId];
      return capsByNativeId[nativeId] || { commands: [], statuses: [] };
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
  console.log('=== DeviceService.getDeviceCapabilities unit tests ===\n');

  await check('returns id + protocol + nativeId together with the adapter-provided fields', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      makeStubAdapter('tuya', {
        capsByNativeId: {
          dev1: {
            name: 'Lamp',
            category: 'kg',
            online: true,
            commands: [{ code: 'switch_1', type: 'Boolean', values: {} }],
            statuses: [{ code: 'switch_1', type: 'Boolean', values: {} }],
          },
        },
      })
    );
    const service = new DeviceService(registry);
    const caps = await service.getDeviceCapabilities('tuya:dev1');
    assert.deepStrictEqual(caps, {
      id: 'tuya:dev1',
      protocol: 'tuya',
      nativeId: 'dev1',
      name: 'Lamp',
      category: 'kg',
      online: true,
      commands: [{ code: 'switch_1', type: 'Boolean', values: {} }],
      statuses: [{ code: 'switch_1', type: 'Boolean', values: {} }],
    });
  });

  await check('routes to the correct adapter and native id among several protocols/devices', async () => {
    const registry = new AdapterRegistry();
    const tuya = makeStubAdapter('tuya', { capsByNativeId: { dev2: { commands: [{ code: 'a' }], statuses: [] } } });
    const mqtt = makeStubAdapter('mqtt');
    registry.register(tuya).register(mqtt);
    const service = new DeviceService(registry);
    const caps = await service.getDeviceCapabilities('tuya:dev2');
    assert.strictEqual(caps.nativeId, 'dev2');
    assert.deepStrictEqual(caps.commands, [{ code: 'a' }]);
    assert.deepStrictEqual(tuya.calls, ['dev2']);
    assert.deepStrictEqual(mqtt.calls, []);
  });

  await check('identity fields come from the resolved id, not from whatever the adapter reports', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      makeStubAdapter('tuya', {
        capsByNativeId: { dev1: { id: 'evil:other', protocol: 'evil', nativeId: 'other', commands: [], statuses: [] } },
      })
    );
    const service = new DeviceService(registry);
    const caps = await service.getDeviceCapabilities('tuya:dev1');
    assert.strictEqual(caps.id, 'tuya:dev1');
    assert.strictEqual(caps.protocol, 'tuya');
    assert.strictEqual(caps.nativeId, 'dev1');
  });

  await check('unknown protocol throws UNKNOWN_PROTOCOL', async () => {
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya'));
    const service = new DeviceService(registry);
    await assert.rejects(
      () => service.getDeviceCapabilities('matter:xyz'),
      (err) => err.code === 'UNKNOWN_PROTOCOL'
    );
  });

  await check('malformed ids throw INVALID_DEVICE_ID and never reach the adapter', async () => {
    const registry = new AdapterRegistry();
    const adapter = makeStubAdapter('tuya');
    registry.register(adapter);
    const service = new DeviceService(registry);
    for (const bad of ['no-prefix', 'tuya:', ':dev1', '']) {
      await assert.rejects(
        () => service.getDeviceCapabilities(bad),
        (err) => err.code === 'INVALID_DEVICE_ID',
        `expected INVALID_DEVICE_ID for "${bad}"`
      );
    }
    assert.deepStrictEqual(adapter.calls, []);
  });

  await check('adapter errors propagate untouched, preserving appCode (AUTH/OFFLINE/NOT_FOUND/UPSTREAM)', async () => {
    for (const appCode of ['AUTH_ERROR', 'DEVICE_OFFLINE', 'DEVICE_NOT_FOUND', 'UPSTREAM_ERROR']) {
      const original = Object.assign(new Error(`simulated ${appCode}`), { appCode });
      const registry = new AdapterRegistry();
      registry.register(makeStubAdapter('tuya', { failNativeIds: { dev1: original } }));
      const service = new DeviceService(registry);
      await assert.rejects(
        () => service.getDeviceCapabilities('tuya:dev1'),
        (err) => err === original && err.appCode === appCode
      );
    }
  });

  await check('an adapter that does not implement getDeviceCapabilities yields a clear UPSTREAM_ERROR', async () => {
    const registry = new AdapterRegistry();
    registry.register({
      protocol: 'legacy',
      async getDevices() {
        return [];
      },
    });
    const service = new DeviceService(registry);
    await assert.rejects(
      () => service.getDeviceCapabilities('legacy:x'),
      (err) => err.appCode === 'UPSTREAM_ERROR' && /does not support capabilities/.test(err.message)
    );
  });

  await check('DeviceAdapter base class: getDeviceCapabilities() throws "not implemented"', async () => {
    class Bare extends DeviceAdapter {
      get protocol() {
        return 'bare';
      }
    }
    await assert.rejects(() => new Bare().getDeviceCapabilities('x'), /getDeviceCapabilities\(x\) not implemented/);
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
