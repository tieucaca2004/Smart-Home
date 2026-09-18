'use strict';

/**
 * API tests — in-process HTTP calls against the Express app, no real Tuya
 * network calls and no real credentials. A FakeTuyaAdapter stands in for
 * the real TuyaAdapter so these tests exercise the actual routing /
 * service / adapter-registry wiring, including the full error taxonomy
 * (AUTH_ERROR, DEVICE_OFFLINE, DEVICE_NOT_FOUND, UPSTREAM_ERROR) that a
 * real protocol adapter's error normalizer would attach via `.appCode`.
 */

const http = require('http');
const assert = require('assert');
const createApp = require('../../src/app');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceAdapter = require('../../src/adapters/DeviceAdapter');
const DeviceService = require('../../src/services/deviceService');

// nativeId -> appCode to simulate for getDeviceStatus/sendCommand on that device.
const SIMULATED_ERRORS = {
  'auth-fail': 'AUTH_ERROR',
  'offline-device': 'DEVICE_OFFLINE',
  'missing-device': 'DEVICE_NOT_FOUND',
  'weird-failure': undefined, // no appCode set -> should fall back to generic 502
};

class FakeTuyaAdapter extends DeviceAdapter {
  get protocol() {
    return 'tuya';
  }

  async getDevices() {
    return [{ id: 'tuya:fake1', nativeId: 'fake1', protocol: 'tuya', name: 'Fake Switch', online: true }];
  }

  async getDeviceStatus(nativeId) {
    if (SIMULATED_ERRORS[nativeId] !== undefined || nativeId in SIMULATED_ERRORS) {
      const err = new Error(`simulated failure for ${nativeId}`);
      if (SIMULATED_ERRORS[nativeId]) err.appCode = SIMULATED_ERRORS[nativeId];
      throw err;
    }
    if (nativeId !== 'fake1') {
      throw Object.assign(new Error(`unknown device ${nativeId}`), { code: 'NOT_FOUND' });
    }
    return [{ code: 'switch_1', value: false }];
  }

  async sendCommand(nativeId, code, value) {
    if (SIMULATED_ERRORS[nativeId] !== undefined || nativeId in SIMULATED_ERRORS) {
      const err = new Error(`simulated failure for ${nativeId}`);
      if (SIMULATED_ERRORS[nativeId]) err.appCode = SIMULATED_ERRORS[nativeId];
      throw err;
    }
    if (nativeId !== 'fake1') {
      throw Object.assign(new Error(`unknown device ${nativeId}`), { code: 'NOT_FOUND' });
    }
    return true;
  }
}

function buildTestApp() {
  const registry = new AdapterRegistry();
  registry.register(new FakeTuyaAdapter());
  const service = new DeviceService(registry);
  return createApp(service);
}

function requestJson(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch (err) {
            // leave json = null on parse failure
          }
          resolve({ statusCode: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
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
  console.log('=== API tests (in-process, no real Tuya network calls) ===\n');

  const app = buildTestApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  await check('GET /health returns ok', async () => {
    const res = await requestJson(server, 'GET', '/health');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'ok');
  });

  await check('GET /api/devices lists devices from registered adapters', async () => {
    const res = await requestJson(server, 'GET', '/api/devices');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(Array.isArray(res.body.devices), true);
    assert.strictEqual(res.body.devices[0].id, 'tuya:fake1');
  });

  await check('GET /api/devices/:id/status returns status for a known device', async () => {
    const res = await requestJson(server, 'GET', '/api/devices/tuya:fake1/status');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.status, [{ code: 'switch_1', value: false }]);
  });

  await check('GET /api/devices/:id/status with unknown protocol returns 400 UNKNOWN_PROTOCOL', async () => {
    const res = await requestJson(server, 'GET', '/api/devices/matter:xyz/status');
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'UNKNOWN_PROTOCOL');
  });

  await check('GET /api/devices/:id/status with malformed id (no protocol prefix) returns 400 INVALID_DEVICE_ID', async () => {
    const res = await requestJson(server, 'GET', '/api/devices/noprefixid/status');
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'INVALID_DEVICE_ID');
  });

  await check('GET /api/devices/:id/status with an empty nativeId ("tuya:") returns 400 INVALID_DEVICE_ID', async () => {
    const res = await requestJson(server, 'GET', '/api/devices/tuya:/status');
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'INVALID_DEVICE_ID');
  });

  await check('GET /api/devices/:id/status maps AUTH_ERROR to 500', async () => {
    const res = await requestJson(server, 'GET', '/api/devices/tuya:auth-fail/status');
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.code, 'AUTH_ERROR');
    assert.strictEqual(res.body.id, 'tuya:auth-fail');
  });

  await check('GET /api/devices/:id/status maps DEVICE_OFFLINE to 409', async () => {
    const res = await requestJson(server, 'GET', '/api/devices/tuya:offline-device/status');
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.code, 'DEVICE_OFFLINE');
  });

  await check('GET /api/devices/:id/status maps DEVICE_NOT_FOUND to 404', async () => {
    const res = await requestJson(server, 'GET', '/api/devices/tuya:missing-device/status');
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'DEVICE_NOT_FOUND');
  });

  await check('GET /api/devices/:id/status with an unclassified adapter error falls back to 502', async () => {
    const res = await requestJson(server, 'GET', '/api/devices/tuya:weird-failure/status');
    assert.strictEqual(res.statusCode, 502);
  });

  await check('POST /api/devices/:id/commands sends a command', async () => {
    const res = await requestJson(server, 'POST', '/api/devices/tuya:fake1/commands', {
      code: 'switch_1',
      value: true,
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.result, true);
  });

  await check('POST /api/devices/:id/commands without code/value returns 400 INVALID_COMMAND', async () => {
    const res = await requestJson(server, 'POST', '/api/devices/tuya:fake1/commands', {});
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'INVALID_COMMAND');
  });

  await check('POST /api/devices/:id/commands with an empty-string code returns 400 INVALID_COMMAND', async () => {
    const res = await requestJson(server, 'POST', '/api/devices/tuya:fake1/commands', { code: '  ', value: true });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'INVALID_COMMAND');
  });

  await check('POST /api/devices/:id/commands with value: false is accepted (not treated as missing)', async () => {
    const res = await requestJson(server, 'POST', '/api/devices/tuya:fake1/commands', {
      code: 'switch_1',
      value: false,
    });
    assert.strictEqual(res.statusCode, 200);
  });

  await check('POST /api/devices/:id/commands for an unknown device returns 502 (unclassified)', async () => {
    const res = await requestJson(server, 'POST', '/api/devices/tuya:unknown/commands', {
      code: 'switch_1',
      value: true,
    });
    assert.strictEqual(res.statusCode, 502);
  });

  await check('POST /api/devices/:id/commands maps DEVICE_OFFLINE to 409', async () => {
    const res = await requestJson(server, 'POST', '/api/devices/tuya:offline-device/commands', {
      code: 'switch_1',
      value: true,
    });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.code, 'DEVICE_OFFLINE');
  });

  await check('GET /unknown-route returns 404', async () => {
    const res = await requestJson(server, 'GET', '/unknown-route');
    assert.strictEqual(res.statusCode, 404);
  });

  await new Promise((resolve) => server.close(resolve));

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
