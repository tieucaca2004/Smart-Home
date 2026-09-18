'use strict';

/**
 * Unit tests for AdapterRegistry — protocol registration, namespaced device
 * id parsing/validation, and the resolve() convenience helper. No network,
 * no adapters beyond simple stubs defined in this file.
 */

const assert = require('assert');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');

function makeStubAdapter(protocol) {
  return {
    protocol,
    async getDevices() {
      return [];
    },
    async getDeviceStatus() {
      return [];
    },
    async sendCommand() {
      return true;
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
  console.log('=== AdapterRegistry unit tests ===\n');

  await check('register() + get() round-trips an adapter by protocol', () => {
    const registry = new AdapterRegistry();
    const tuya = makeStubAdapter('tuya');
    registry.register(tuya);
    assert.strictEqual(registry.get('tuya'), tuya);
  });

  await check('register() rejects an adapter with no .protocol', () => {
    const registry = new AdapterRegistry();
    assert.throws(() => registry.register({}), /non-empty \.protocol/);
  });

  await check('has() reflects registered protocols', () => {
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya'));
    assert.strictEqual(registry.has('tuya'), true);
    assert.strictEqual(registry.has('matter'), false);
  });

  await check('get() throws UNKNOWN_PROTOCOL for an unregistered protocol', () => {
    const registry = new AdapterRegistry();
    try {
      registry.get('matter');
      assert.fail('expected get() to throw');
    } catch (err) {
      assert.strictEqual(err.code, 'UNKNOWN_PROTOCOL');
    }
  });

  await check('list() returns every registered adapter', () => {
    const registry = new AdapterRegistry();
    const tuya = makeStubAdapter('tuya');
    const matter = makeStubAdapter('matter');
    registry.register(tuya).register(matter);
    assert.deepStrictEqual(registry.list().sort((a, b) => a.protocol.localeCompare(b.protocol)), [matter, tuya]);
  });

  await check('parseDeviceId() splits "protocol:nativeId" correctly', () => {
    const { protocol, nativeId } = AdapterRegistry.parseDeviceId('tuya:1638018234ab950e1ecd');
    assert.strictEqual(protocol, 'tuya');
    assert.strictEqual(nativeId, '1638018234ab950e1ecd');
  });

  await check('parseDeviceId() handles a nativeId that itself contains a colon', () => {
    const { protocol, nativeId } = AdapterRegistry.parseDeviceId('mqtt:room1:switch1');
    assert.strictEqual(protocol, 'mqtt');
    assert.strictEqual(nativeId, 'room1:switch1');
  });

  await check('parseDeviceId() throws INVALID_DEVICE_ID with no colon', () => {
    try {
      AdapterRegistry.parseDeviceId('noprefixid');
      assert.fail('expected throw');
    } catch (err) {
      assert.strictEqual(err.code, 'INVALID_DEVICE_ID');
    }
  });

  await check('parseDeviceId() throws INVALID_DEVICE_ID for an empty nativeId ("tuya:")', () => {
    try {
      AdapterRegistry.parseDeviceId('tuya:');
      assert.fail('expected throw');
    } catch (err) {
      assert.strictEqual(err.code, 'INVALID_DEVICE_ID');
    }
  });

  await check('parseDeviceId() throws INVALID_DEVICE_ID for an empty protocol (":abc123")', () => {
    try {
      AdapterRegistry.parseDeviceId(':abc123');
      assert.fail('expected throw');
    } catch (err) {
      assert.strictEqual(err.code, 'INVALID_DEVICE_ID');
    }
  });

  await check('parseDeviceId() throws INVALID_DEVICE_ID for a non-string input', () => {
    try {
      AdapterRegistry.parseDeviceId(undefined);
      assert.fail('expected throw');
    } catch (err) {
      assert.strictEqual(err.code, 'INVALID_DEVICE_ID');
    }
  });

  await check('resolve() returns { protocol, nativeId, adapter } for a known protocol', () => {
    const registry = new AdapterRegistry();
    const tuya = makeStubAdapter('tuya');
    registry.register(tuya);
    const resolved = registry.resolve('tuya:1638018234ab950e1ecd');
    assert.strictEqual(resolved.protocol, 'tuya');
    assert.strictEqual(resolved.nativeId, '1638018234ab950e1ecd');
    assert.strictEqual(resolved.adapter, tuya);
  });

  await check('resolve() throws UNKNOWN_PROTOCOL for an unregistered protocol prefix', () => {
    const registry = new AdapterRegistry();
    registry.register(makeStubAdapter('tuya'));
    try {
      registry.resolve('matter:xyz');
      assert.fail('expected throw');
    } catch (err) {
      assert.strictEqual(err.code, 'UNKNOWN_PROTOCOL');
    }
  });

  await check('resolve() throws INVALID_DEVICE_ID before ever checking the registry', () => {
    const registry = new AdapterRegistry(); // no adapters registered at all
    try {
      registry.resolve('malformed-id');
      assert.fail('expected throw');
    } catch (err) {
      assert.strictEqual(err.code, 'INVALID_DEVICE_ID');
    }
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
