'use strict';

/**
 * Offline unit tests for TuyaAdapter — no network, no real credentials.
 * The real HTTPS call is replaced with an injected fake (`httpRequest`
 * option) that returns canned responses, so this never talks to Tuya and
 * never needs TUYA_ACCESS_ID/TUYA_ACCESS_SECRET to be set for real.
 */

const assert = require('assert');
const TuyaAdapter = require('../../src/adapters/tuya/TuyaAdapter');

const DUMMY_ACCESS_ID = 'dummy_access_id';
const DUMMY_ACCESS_SECRET = 'dummy_access_secret';

const TOKEN_RESPONSE = {
  statusCode: 200,
  body: { success: true, result: { access_token: 'tok123', expire_time: 7200 } },
};

function makeFakeHttp(responses) {
  const calls = [];
  const fn = async (baseUrl, { method, path, body }) => {
    calls.push({ baseUrl, method, path, body });
    const next = responses.shift();
    if (!next) throw new Error('makeFakeHttp: no more canned responses configured');
    return next;
  };
  fn.calls = calls;
  return fn;
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
  console.log('=== TuyaAdapter offline unit tests (no network, no real credentials) ===\n');

  await check('constructor throws without credentials', () => {
    assert.throws(() => new TuyaAdapter({ accessId: '', accessSecret: '' }), /Missing Tuya credentials/);
  });

  await check('protocol getter returns "tuya"', () => {
    const adapter = new TuyaAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET });
    assert.strictEqual(adapter.protocol, 'tuya');
  });

  await check('_sign() produces a 64-char uppercase hex HMAC-SHA256 digest', () => {
    const adapter = new TuyaAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET });
    const { sign } = adapter._sign('GET', '/v1.0/token?grant_type=1', null, null);
    assert.match(sign, /^[0-9A-F]{64}$/);
  });

  await check('_sign() changes when the path changes', () => {
    const adapter = new TuyaAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET });
    const a = adapter._sign('GET', '/v1.0/foo', null, 'tok').sign;
    const b = adapter._sign('GET', '/v1.0/bar', null, 'tok').sign;
    assert.notStrictEqual(a, b);
  });

  await check('getDeviceStatus() calls GET .../status with the right path', async () => {
    const http = makeFakeHttp([
      TOKEN_RESPONSE,
      { statusCode: 200, body: { success: true, result: [{ code: 'switch_1', value: false }] } },
    ]);
    const adapter = new TuyaAdapter({
      accessId: DUMMY_ACCESS_ID,
      accessSecret: DUMMY_ACCESS_SECRET,
      httpRequest: http,
    });
    const status = await adapter.getDeviceStatus('dev123');
    assert.deepStrictEqual(status, [{ code: 'switch_1', value: false }]);
    assert.strictEqual(http.calls[1].method, 'GET');
    assert.strictEqual(http.calls[1].path, '/v1.0/iot-03/devices/dev123/status');
  });

  await check('sendCommand() builds the correct POST body', async () => {
    const http = makeFakeHttp([TOKEN_RESPONSE, { statusCode: 200, body: { success: true, result: true } }]);
    const adapter = new TuyaAdapter({
      accessId: DUMMY_ACCESS_ID,
      accessSecret: DUMMY_ACCESS_SECRET,
      httpRequest: http,
    });
    const result = await adapter.sendCommand('dev123', 'switch_1', true);
    assert.strictEqual(result, true);
    assert.strictEqual(http.calls[1].method, 'POST');
    assert.strictEqual(http.calls[1].path, '/v1.0/iot-03/devices/dev123/commands');
    assert.deepStrictEqual(http.calls[1].body, { commands: [{ code: 'switch_1', value: true }] });
  });

  await check('sendCommand() rejects a missing nativeId', async () => {
    const adapter = new TuyaAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET });
    await assert.rejects(() => adapter.sendCommand(undefined, 'switch_1', true), /nativeId is required/);
  });

  await check('sendCommand() rejects a missing code', async () => {
    const adapter = new TuyaAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET });
    await assert.rejects(() => adapter.sendCommand('dev123', undefined, true), /code is required/);
  });

  await check('getDevices() returns [] when no device ids are configured', async () => {
    const adapter = new TuyaAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET });
    const devices = await adapter.getDevices();
    assert.deepStrictEqual(devices, []);
  });

  await check('getDevices() fetches Query Device Details for each configured id', async () => {
    const http = makeFakeHttp([
      TOKEN_RESPONSE,
      { statusCode: 200, body: { success: true, result: { name: 'Đèn Quán Quầy', category: 'kg', is_online: true } } },
    ]);
    const adapter = new TuyaAdapter({
      accessId: DUMMY_ACCESS_ID,
      accessSecret: DUMMY_ACCESS_SECRET,
      deviceIds: '1638018234ab950e1ecd',
      httpRequest: http,
    });
    const devices = await adapter.getDevices();
    assert.strictEqual(devices.length, 1);
    assert.strictEqual(devices[0].id, 'tuya:1638018234ab950e1ecd');
    assert.strictEqual(devices[0].name, 'Đèn Quán Quầy');
    assert.strictEqual(devices[0].online, true);
    assert.strictEqual(http.calls[1].method, 'GET');
    assert.strictEqual(http.calls[1].path, '/v2.0/cloud/thing/1638018234ab950e1ecd');
  });

  await check('getDevices() captures a per-device error instead of throwing', async () => {
    const http = makeFakeHttp([TOKEN_RESPONSE, { statusCode: 200, body: { success: false, code: 40001900, msg: 'No space permission' } }]);
    const adapter = new TuyaAdapter({
      accessId: DUMMY_ACCESS_ID,
      accessSecret: DUMMY_ACCESS_SECRET,
      deviceIds: 'bad_device_id',
      httpRequest: http,
    });
    const devices = await adapter.getDevices();
    assert.strictEqual(devices.length, 1);
    assert.strictEqual(devices[0].id, 'tuya:bad_device_id');
    assert.match(devices[0].error, /No space permission/);
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
