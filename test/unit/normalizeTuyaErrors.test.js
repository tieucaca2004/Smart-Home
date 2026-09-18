'use strict';

/**
 * Unit tests for the Tuya error-classification wrapper. No network, no
 * real TuyaAdapter instance needed — a tiny fake adapter stands in so we
 * can control exactly which errors getDeviceStatus()/sendCommand() throw.
 */

const assert = require('assert');
const { classifyTuyaError, wrapWithErrorNormalization } = require('../../src/adapters/tuya/normalizeTuyaErrors');

function fakeTuyaError(code, msg) {
  const err = new Error(`Tuya API error on GET /v1.0/iot-03/devices/x/status: code=${code} msg=${msg}`);
  err.code = code;
  err.response = { success: false, code, msg };
  return err;
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
  console.log('=== normalizeTuyaErrors unit tests ===\n');

  await check('classifyTuyaError: code 1004 (sign invalid) -> AUTH_ERROR', () => {
    assert.strictEqual(classifyTuyaError(fakeTuyaError(1004, 'sign invalid')), 'AUTH_ERROR');
  });

  await check('classifyTuyaError: code 1106 (permission deny) -> AUTH_ERROR', () => {
    assert.strictEqual(classifyTuyaError(fakeTuyaError(1106, 'permission deny')), 'AUTH_ERROR');
  });

  await check('classifyTuyaError: code 40001900 (No space permission) -> AUTH_ERROR', () => {
    assert.strictEqual(classifyTuyaError(fakeTuyaError(40001900, 'No space permission')), 'AUTH_ERROR');
  });

  await check('classifyTuyaError: message mentions "offline" -> DEVICE_OFFLINE', () => {
    assert.strictEqual(classifyTuyaError(fakeTuyaError(9999, 'device is offline')), 'DEVICE_OFFLINE');
  });

  await check('classifyTuyaError: message mentions "not exist" -> DEVICE_NOT_FOUND', () => {
    assert.strictEqual(classifyTuyaError(fakeTuyaError(9999, 'device not exist')), 'DEVICE_NOT_FOUND');
  });

  await check('classifyTuyaError: unrecognized code/message -> UPSTREAM_ERROR (safe default)', () => {
    assert.strictEqual(classifyTuyaError(fakeTuyaError(500, 'internal error')), 'UPSTREAM_ERROR');
  });

  await check('classifyTuyaError: never inspects or requires any credential field', () => {
    const err = new Error('sign invalid');
    err.code = 1004;
    // deliberately no accessId/accessSecret anywhere on this error object
    assert.strictEqual(classifyTuyaError(err), 'AUTH_ERROR');
  });

  await check('wrapWithErrorNormalization: success path returns the real adapter result unchanged', async () => {
    const realAdapter = {
      protocol: 'tuya',
      async getDevices() {
        return [{ id: 'tuya:x' }];
      },
      async getDeviceStatus() {
        return [{ code: 'switch_1', value: true }];
      },
      async sendCommand() {
        return true;
      },
    };
    const wrapped = wrapWithErrorNormalization(realAdapter);
    assert.strictEqual(wrapped.protocol, 'tuya');
    assert.deepStrictEqual(await wrapped.getDevices(), [{ id: 'tuya:x' }]);
    assert.deepStrictEqual(await wrapped.getDeviceStatus('x'), [{ code: 'switch_1', value: true }]);
    assert.strictEqual(await wrapped.sendCommand('x', 'switch_1', true), true);
  });

  await check('wrapWithErrorNormalization: getDeviceStatus() failure gets .appCode attached', async () => {
    const failingAdapter = {
      protocol: 'tuya',
      async getDevices() {
        return [];
      },
      async getDeviceStatus() {
        throw fakeTuyaError(1004, 'sign invalid');
      },
      async sendCommand() {
        return true;
      },
    };
    const wrapped = wrapWithErrorNormalization(failingAdapter);
    await assert.rejects(
      () => wrapped.getDeviceStatus('x'),
      (err) => err.appCode === 'AUTH_ERROR'
    );
  });

  await check('wrapWithErrorNormalization: sendCommand() failure gets .appCode attached', async () => {
    const failingAdapter = {
      protocol: 'tuya',
      async getDevices() {
        return [];
      },
      async getDeviceStatus() {
        return [];
      },
      async sendCommand() {
        throw fakeTuyaError(9999, 'device is offline');
      },
    };
    const wrapped = wrapWithErrorNormalization(failingAdapter);
    await assert.rejects(
      () => wrapped.sendCommand('x', 'switch_1', true),
      (err) => err.appCode === 'DEVICE_OFFLINE'
    );
  });

  await check('wrapWithErrorNormalization: does not overwrite an .appCode the adapter already set', async () => {
    const failingAdapter = {
      protocol: 'tuya',
      async getDevices() {
        return [];
      },
      async getDeviceStatus() {
        const err = fakeTuyaError(1004, 'sign invalid');
        err.appCode = 'DEVICE_NOT_FOUND'; // pretend something upstream already classified this
        throw err;
      },
      async sendCommand() {
        return true;
      },
    };
    const wrapped = wrapWithErrorNormalization(failingAdapter);
    await assert.rejects(
      () => wrapped.getDeviceStatus('x'),
      (err) => err.appCode === 'DEVICE_NOT_FOUND'
    );
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
