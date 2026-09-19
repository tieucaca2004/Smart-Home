'use strict';

/**
 * API tests for GET /api/devices with device discovery — in-process HTTP against
 * the Express app, through the REAL stack (route -> DeviceService -> registry ->
 * error wrapper -> TuyaDiscoveryAdapter) on a fake HTTPS transport. No real
 * network, no real credentials. Fixtures are synthetic (Tuya's documented shape).
 *
 * It proves that the Hub lists every device the (fake) Tuya project has, that a
 * device found only by discovery can then be used through the per-device routes,
 * that nothing private from Tuya reaches a response, and that a refused
 * discovery call degrades to the configured devices instead of an error.
 */

const http = require('http');
const assert = require('assert');
const createApp = require('../../src/app');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceService = require('../../src/services/deviceService');
const TuyaDiscoveryAdapter = require('../../src/adapters/tuya/TuyaDiscoveryAdapter');
const { wrapWithErrorNormalization } = require('../../src/adapters/tuya/normalizeTuyaErrors');

const DUMMY_ACCESS_ID = 'dummy_access_id';
const DUMMY_ACCESS_SECRET = 'super-secret-DO-NOT-LEAK';
const DUMMY_TOKEN = 'tok-abc-999-DO-NOT-LEAK';
const DISCOVERY = '/v1.0/iot-01/associated-users/devices';

const ok = (result) => ({ statusCode: 200, body: { success: true, result } });
const fail = (code, msg) => ({ statusCode: 200, body: { success: false, code, msg } });

const raw = (id, name, category, online) => ({
  id,
  name,
  category,
  online,
  local_key: `LOCALKEY-DO-NOT-LEAK-${id}`,
  ip: '203.0.113.9',
  uid: 'gg-user-DO-NOT-LEAK',
});

// Three devices the project can see, none of them "the" device of any earlier sprint.
const PROJECT_DEVICES = [
  raw('dev-a', 'Công tắc phòng khách', 'kg', true),
  raw('dev-b', 'Quạt trần', 'fs', false),
  raw('dev-c', 'Ổ cắm bếp', 'cz', true),
];

function makeStack({ discoveryFails = false, deviceIds = '' } = {}) {
  const calls = [];
  const responses = {
    [`${DISCOVERY}?size=50`]: discoveryFails ? fail(1106, 'permission deny') : ok({ has_more: false, total: 3, devices: PROJECT_DEVICES }),
    '/v1.0/iot-03/devices/dev-c/status': ok([{ code: 'switch_1', value: true }]),
    '/v1.0/iot-03/devices/dev-c/specification': ok({
      category: 'cz',
      functions: [{ code: 'switch_1', name: 'Switch 1', type: 'Boolean', values: '{}' }],
      status: [{ code: 'switch_1', name: 'Switch 1', type: 'Boolean', values: '{}' }],
    }),
    '/v2.0/cloud/thing/dev-c': ok({ name: 'Ổ cắm bếp', category: 'cz', is_online: true }),
    '/v2.0/cloud/thing/dev-a': ok({ name: 'Công tắc phòng khách', category: 'kg', is_online: true }),
  };
  const transport = async (baseUrl, req) => {
    calls.push(req);
    if (req.path.startsWith('/v1.0/token')) return ok({ access_token: DUMMY_TOKEN, expire_time: 7200 });
    const res = responses[req.path];
    if (!res) throw new Error(`fake transport: unexpected path ${req.path}`);
    return res;
  };
  const adapter = new TuyaDiscoveryAdapter({
    accessId: DUMMY_ACCESS_ID,
    accessSecret: DUMMY_ACCESS_SECRET,
    deviceIds,
    httpRequest: transport,
  });
  const registry = new AdapterRegistry();
  registry.register(wrapWithErrorNormalization(adapter));
  return { app: createApp(new DeviceService(registry)), calls };
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch (err) {
          // leave json = null on parse failure
        }
        resolve({ statusCode: res.statusCode, body: json, raw: body });
      });
    });
    req.on('error', reject);
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
  console.log('=== Discovery API tests (in-process, no real Tuya network calls) ===\n');

  const stack = makeStack();
  const server = await startServer(stack.app);

  await check('GET /api/devices lists every device the project has, with nothing configured', async () => {
    const res = await request(server, 'GET', '/api/devices');

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, {
      devices: [
        { id: 'tuya:dev-a', nativeId: 'dev-a', protocol: 'tuya', name: 'Công tắc phòng khách', category: 'kg', online: true },
        { id: 'tuya:dev-b', nativeId: 'dev-b', protocol: 'tuya', name: 'Quạt trần', category: 'fs', online: false },
        { id: 'tuya:dev-c', nativeId: 'dev-c', protocol: 'tuya', name: 'Ổ cắm bếp', category: 'cz', online: true },
      ],
    });
  });

  await check('the offline device is listed, marked offline', async () => {
    const res = await request(server, 'GET', '/api/devices');
    const fan = res.body.devices.find((d) => d.id === 'tuya:dev-b');
    assert.strictEqual(fan.online, false);
  });

  await check('no secret, token, signature or private Tuya field appears in the response', async () => {
    const res = await request(server, 'GET', '/api/devices');

    for (const leaked of [DUMMY_ACCESS_SECRET, DUMMY_TOKEN, 'LOCALKEY', 'local_key', '203.0.113.9', 'gg-user']) {
      assert.strictEqual(res.raw.includes(leaked), false, `${leaked} leaked`);
    }
    assert.strictEqual(/[0-9A-F]{64}/.test(res.raw), false, 'a signature-like 64-hex string leaked');
  });

  await check('listing only ever reads: every Tuya call is a GET, none is a command', async () => {
    await request(server, 'GET', '/api/devices');

    assert.strictEqual(stack.calls.every((c) => c.method === 'GET'), true);
    assert.strictEqual(stack.calls.some((c) => c.path.includes('/commands')), false);
  });

  await check('a device found only by discovery works through the per-device routes (status)', async () => {
    const res = await request(server, 'GET', '/api/devices/tuya:dev-c/status');

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { id: 'tuya:dev-c', status: [{ code: 'switch_1', value: true }] });
    assert.ok(stack.calls.some((c) => c.path === '/v1.0/iot-03/devices/dev-c/status'));
  });

  await check('a device found only by discovery works through the per-device routes (capabilities)', async () => {
    const res = await request(server, 'GET', '/api/devices/tuya:dev-c/capabilities');

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.id, 'tuya:dev-c');
    assert.strictEqual(res.body.capabilities.nativeId, 'dev-c');
    assert.deepStrictEqual(res.body.capabilities.commands.map((c) => c.code), ['switch_1']);
  });

  await new Promise((resolve) => server.close(resolve));

  const configuredStack = makeStack({ deviceIds: 'dev-a' });
  const configuredServer = await startServer(configuredStack.app);

  await check('a configured id and discovery together list each device once, configured first', async () => {
    const res = await request(configuredServer, 'GET', '/api/devices');

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.devices.map((d) => d.id), ['tuya:dev-a', 'tuya:dev-b', 'tuya:dev-c']);
  });

  await new Promise((resolve) => configuredServer.close(resolve));

  const refusedStack = makeStack({ discoveryFails: true, deviceIds: 'dev-a' });
  const refusedServer = await startServer(refusedStack.app);

  await check('if Tuya refuses discovery, GET /api/devices still answers 200 with the configured devices', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const res = await request(refusedServer, 'GET', '/api/devices');

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body.devices.map((d) => d.id), ['tuya:dev-a']);
    } finally {
      console.warn = originalWarn;
    }
  });

  await new Promise((resolve) => refusedServer.close(resolve));

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
