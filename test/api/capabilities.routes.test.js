'use strict';

/**
 * API tests for GET /api/devices/:id/capabilities — in-process HTTP against the
 * Express app. No real network, no real credentials.
 *
 * Two layers:
 *   1. A FakeAdapter (extends DeviceAdapter) to cover routing, response shape and
 *      the full error taxonomy's HTTP mapping.
 *   2. The REAL TuyaAdapter wrapped with wrapWithErrorNormalization, driven by a
 *      fake HTTPS transport, to prove the whole stack (route -> service ->
 *      registry -> wrapper -> adapter) end to end, and that nothing sensitive
 *      (secret / token / signature) can appear in a response body.
 *
 * Fixtures are synthetic (documented Tuya response shape), not a recording of
 * the real device's specification.
 */

const http = require('http');
const assert = require('assert');
const createApp = require('../../src/app');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceAdapter = require('../../src/adapters/DeviceAdapter');
const DeviceService = require('../../src/services/deviceService');
const TuyaAdapter = require('../../src/adapters/tuya/TuyaAdapter');
const { wrapWithErrorNormalization } = require('../../src/adapters/tuya/normalizeTuyaErrors');

// ---------------------------------------------------------------- fake adapter

const SIMULATED_ERRORS = {
  'auth-fail': 'AUTH_ERROR',
  'offline-device': 'DEVICE_OFFLINE',
  'missing-device': 'DEVICE_NOT_FOUND',
  'upstream-fail': 'UPSTREAM_ERROR',
  'weird-failure': undefined, // no appCode -> generic 502 fallback
};

class FakeAdapter extends DeviceAdapter {
  get protocol() {
    return 'tuya';
  }

  async getDevices() {
    return [];
  }

  async getDeviceCapabilities(nativeId) {
    if (nativeId in SIMULATED_ERRORS) {
      const err = new Error(`simulated failure for ${nativeId}`);
      if (SIMULATED_ERRORS[nativeId]) err.appCode = SIMULATED_ERRORS[nativeId];
      throw err;
    }
    return {
      nativeId,
      protocol: 'tuya',
      name: 'Fake Switch',
      category: 'kg',
      online: true,
      commands: [{ code: 'switch_1', type: 'Boolean', values: {} }],
      statuses: [{ code: 'switch_1', type: 'Boolean', values: {} }],
    };
  }
}

// ------------------------------------------------ real TuyaAdapter + fake transport

const REAL_DEVICE_NATIVE_ID = '1638018234ab950e1ecd'; // id only; transport below is fake
const DUMMY_ACCESS_ID = 'dummy_access_id';
const DUMMY_ACCESS_SECRET = 'super-secret-DO-NOT-LEAK';
const DUMMY_TOKEN = 'tok-abc-999-DO-NOT-LEAK';

const ok = (result) => ({ statusCode: 200, body: { success: true, result } });
const fail = (code, msg) => ({ statusCode: 200, body: { success: false, code, msg } });

function makeTuyaStack({ tokenFails = false } = {}) {
  const calls = [];
  const responses = {
    [`/v1.0/iot-03/devices/${REAL_DEVICE_NATIVE_ID}/specification`]: ok({
      category: 'kg',
      functions: [{ code: 'switch_1', name: 'Switch 1', type: 'Boolean', values: '{}' }],
      status: [{ code: 'switch_1', name: 'Switch 1', type: 'Boolean', values: '{}' }],
    }),
    [`/v2.0/cloud/thing/${REAL_DEVICE_NATIVE_ID}`]: ok({ name: 'Synthetic Light', category: 'kg', is_online: true }),
    '/v1.0/iot-03/devices/perm-denied/specification': fail(1106, 'permission deny'),
    '/v1.0/iot-03/devices/gone/specification': fail(2001, 'device not exist'),
    '/v1.0/iot-03/devices/sleepy/specification': fail(2008, 'device is offline'),
    '/v1.0/iot-03/devices/broken/specification': fail(500, 'internal error'),
  };
  const transport = async (baseUrl, req) => {
    calls.push(req);
    if (req.path.startsWith('/v1.0/token')) {
      return tokenFails ? fail(1004, 'sign invalid') : ok({ access_token: DUMMY_TOKEN, expire_time: 7200 });
    }
    const res = responses[req.path];
    if (!res) throw new Error(`fake transport: unexpected path ${req.path}`);
    return res;
  };
  const adapter = wrapWithErrorNormalization(
    new TuyaAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET, httpRequest: transport })
  );
  const registry = new AdapterRegistry();
  registry.register(adapter);
  return { app: createApp(new DeviceService(registry)), calls };
}

// ------------------------------------------------------------------- helpers

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path }, (res) => {
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
        resolve({ statusCode: res.statusCode, body: json, raw });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function assertNoSecrets(raw, calls) {
  assert.strictEqual(raw.includes(DUMMY_ACCESS_SECRET), false, 'access secret leaked');
  assert.strictEqual(raw.includes(DUMMY_TOKEN), false, 'access token leaked');
  assert.strictEqual(/[0-9A-F]{64}/.test(raw), false, 'a signature-like 64-hex string leaked');
  for (const call of calls) {
    if (call.headers && call.headers.sign) assert.strictEqual(raw.includes(call.headers.sign), false, 'signature leaked');
  }
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
  console.log('=== Capabilities API tests (in-process, no real Tuya network calls) ===\n');

  // ---- layer 1: FakeAdapter --------------------------------------------------
  const fakeRegistry = new AdapterRegistry();
  fakeRegistry.register(new FakeAdapter());
  const fakeServer = await startServer(createApp(new DeviceService(fakeRegistry)));

  await check('GET /api/devices/:id/capabilities returns 200 with { id, capabilities }', async () => {
    const res = await request(fakeServer, 'GET', '/api/devices/tuya:fake1/capabilities');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, {
      id: 'tuya:fake1',
      capabilities: {
        id: 'tuya:fake1',
        protocol: 'tuya',
        nativeId: 'fake1',
        name: 'Fake Switch',
        category: 'kg',
        online: true,
        commands: [{ code: 'switch_1', type: 'Boolean', values: {} }],
        statuses: [{ code: 'switch_1', type: 'Boolean', values: {} }],
      },
    });
  });

  await check('unknown protocol returns 400 UNKNOWN_PROTOCOL', async () => {
    const res = await request(fakeServer, 'GET', '/api/devices/matter:xyz/capabilities');
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'UNKNOWN_PROTOCOL');
    assert.strictEqual(res.body.id, 'matter:xyz');
  });

  await check('malformed id (no protocol prefix) returns 400 INVALID_DEVICE_ID', async () => {
    const res = await request(fakeServer, 'GET', '/api/devices/noprefixid/capabilities');
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'INVALID_DEVICE_ID');
  });

  await check('malformed id (empty nativeId "tuya:") returns 400 INVALID_DEVICE_ID', async () => {
    const res = await request(fakeServer, 'GET', '/api/devices/tuya:/capabilities');
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'INVALID_DEVICE_ID');
  });

  const mapping = [
    ['auth-fail', 500, 'AUTH_ERROR'],
    ['offline-device', 409, 'DEVICE_OFFLINE'],
    ['missing-device', 404, 'DEVICE_NOT_FOUND'],
    ['upstream-fail', 502, 'UPSTREAM_ERROR'],
  ];
  for (const [nativeId, status, code] of mapping) {
    await check(`adapter error ${code} propagates as HTTP ${status} with code + id`, async () => {
      const res = await request(fakeServer, 'GET', `/api/devices/tuya:${nativeId}/capabilities`);
      assert.strictEqual(res.statusCode, status);
      assert.strictEqual(res.body.code, code);
      assert.strictEqual(res.body.id, `tuya:${nativeId}`);
      assert.match(res.body.error, /simulated failure/);
    });
  }

  await check('an unclassified adapter error falls back to 502', async () => {
    const res = await request(fakeServer, 'GET', '/api/devices/tuya:weird-failure/capabilities');
    assert.strictEqual(res.statusCode, 502);
  });

  await check('an unknown sub-route under a device id still returns 404', async () => {
    const res = await request(fakeServer, 'GET', '/api/devices/tuya:fake1/capabilities-typo');
    assert.strictEqual(res.statusCode, 404);
  });

  await new Promise((resolve) => fakeServer.close(resolve));

  // ---- layer 2: real TuyaAdapter + wrapper, fake transport ---------------------
  const stack = makeTuyaStack();
  const tuyaServer = await startServer(stack.app);

  await check('end-to-end: real TuyaAdapter (fake transport) serves capabilities for the baseline device id', async () => {
    const res = await request(tuyaServer, 'GET', `/api/devices/tuya:${REAL_DEVICE_NATIVE_ID}/capabilities`);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, {
      id: `tuya:${REAL_DEVICE_NATIVE_ID}`,
      capabilities: {
        id: `tuya:${REAL_DEVICE_NATIVE_ID}`,
        protocol: 'tuya',
        nativeId: REAL_DEVICE_NATIVE_ID,
        name: 'Synthetic Light',
        category: 'kg',
        online: true,
        commands: [{ code: 'switch_1', type: 'Boolean', name: 'Switch 1', values: {} }],
        statuses: [{ code: 'switch_1', type: 'Boolean', name: 'Switch 1', values: {} }],
      },
    });
    assertNoSecrets(res.raw, stack.calls);
  });

  await check('end-to-end: capabilities never issues a write (no POST, no /commands)', async () => {
    assert.strictEqual(stack.calls.every((c) => c.method === 'GET'), true);
    assert.strictEqual(stack.calls.some((c) => c.path.includes('/commands')), false);
  });

  const e2eErrors = [
    ['perm-denied', 500, 'AUTH_ERROR'],
    ['gone', 404, 'DEVICE_NOT_FOUND'],
    ['sleepy', 409, 'DEVICE_OFFLINE'],
    ['broken', 502, 'UPSTREAM_ERROR'],
  ];
  for (const [nativeId, status, code] of e2eErrors) {
    await check(`end-to-end: Tuya failure for "${nativeId}" -> HTTP ${status} ${code}, no secrets in body`, async () => {
      const res = await request(tuyaServer, 'GET', `/api/devices/tuya:${nativeId}/capabilities`);
      assert.strictEqual(res.statusCode, status);
      assert.strictEqual(res.body.code, code);
      assert.deepStrictEqual(Object.keys(res.body).sort(), ['code', 'error', 'id']);
      assertNoSecrets(res.raw, stack.calls);
    });
  }

  await new Promise((resolve) => tuyaServer.close(resolve));

  const badTokenStack = makeTuyaStack({ tokenFails: true });
  const badTokenServer = await startServer(badTokenStack.app);

  await check('end-to-end: token/signing failure -> 500 AUTH_ERROR, no secrets in body', async () => {
    const res = await request(badTokenServer, 'GET', `/api/devices/tuya:${REAL_DEVICE_NATIVE_ID}/capabilities`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.code, 'AUTH_ERROR');
    assertNoSecrets(res.raw, badTokenStack.calls);
  });

  await new Promise((resolve) => badTokenServer.close(resolve));

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
