'use strict';

/**
 * API tests (Round C / F-04): the optional `HUB_API_TOKEN` auth middleware,
 * mounted via createApp's `extra.hubApiToken`. In-process server on
 * 127.0.0.1 with a fake adapter: no real Tuya network calls, no real
 * credentials, no real devices, no data files touched.
 */

const http = require('http');
const assert = require('assert');
const createApp = require('../../src/app');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceService = require('../../src/services/deviceService');

const FAKE_ID = 'fake:dev1';

const fakeAdapter = {
  get protocol() {
    return 'fake';
  },
  async getDevices() {
    return [{ id: FAKE_ID, nativeId: 'dev1', protocol: 'fake', name: 'Fake', online: true }];
  },
  async getDeviceStatus() {
    return [{ code: 'sw', value: false }];
  },
  async sendCommand() {
    return true;
  },
};

function buildApp(extra = {}) {
  const registry = new AdapterRegistry();
  registry.register(fakeAdapter);
  return createApp(new DeviceService(registry), extra);
}

function requestJson(server, method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const reqHeaders = Object.assign({}, headers);
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, method, path: urlPath, headers: reqHeaders },
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
            // leave json = null
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
    console.log(`      ${err.stack || err.message}`);
    failCount += 1;
  }
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await fn(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  console.log('=== authToken API tests (F-04, no real Tuya calls) ===\n');

  // ---------------------------------------------------------------- no token configured (backward compat)
  await withServer(buildApp(), async (server) => {
    await check('HUB_API_TOKEN unset: GET /api/devices works with no Authorization header', async () => {
      const res = await requestJson(server, 'GET', '/api/devices');
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(Array.isArray(res.body.devices), true);
    });

    await check('HUB_API_TOKEN unset: GET /api/scenes works with no Authorization header', async () => {
      const res = await requestJson(server, 'GET', '/api/scenes');
      assert.strictEqual(res.statusCode, 200);
    });

    await check('HUB_API_TOKEN unset: GET /api/automations works with no Authorization header', async () => {
      const res = await requestJson(server, 'GET', '/api/automations');
      assert.strictEqual(res.statusCode, 200);
    });

    await check('HUB_API_TOKEN unset: GET /health works with no Authorization header', async () => {
      const res = await requestJson(server, 'GET', '/health');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, { status: 'ok' });
    });
  });

  // ---------------------------------------------------------------- token configured
  const TOKEN = 'round-c-secret-token';
  await withServer(buildApp({ hubApiToken: TOKEN }), async (server) => {
    for (const route of ['/api/devices', '/api/scenes', '/api/automations']) {
      await check(`HUB_API_TOKEN set: GET ${route} with no Authorization header -> 401 UNAUTHORIZED`, async () => {
        const res = await requestJson(server, 'GET', route);
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(res.body.code, 'UNAUTHORIZED');
      });

      await check(`HUB_API_TOKEN set: GET ${route} with a wrong token -> 401 UNAUTHORIZED`, async () => {
        const res = await requestJson(server, 'GET', route, { headers: { Authorization: 'Bearer wrong-token' } });
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(res.body.code, 'UNAUTHORIZED');
      });

      await check(`HUB_API_TOKEN set: GET ${route} with the correct token -> 200, same as unauthenticated case`, async () => {
        const res = await requestJson(server, 'GET', route, { headers: { Authorization: `Bearer ${TOKEN}` } });
        assert.strictEqual(res.statusCode, 200);
      });
    }

    await check('HUB_API_TOKEN set: GET /health still works with no Authorization header', async () => {
      const res = await requestJson(server, 'GET', '/health');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, { status: 'ok' });
    });

    await check('HUB_API_TOKEN set: POST /api/devices/:id/commands with correct token behaves as before', async () => {
      const res = await requestJson(server, 'POST', `/api/devices/${FAKE_ID}/commands`, {
        body: { code: 'sw', value: true },
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.result, true);
    });

    await check('HUB_API_TOKEN set: POST /api/devices/:id/commands without token -> 401, no command sent', async () => {
      const res = await requestJson(server, 'POST', `/api/devices/${FAKE_ID}/commands`, {
        body: { code: 'sw', value: true },
      });
      assert.strictEqual(res.statusCode, 401);
    });
  });

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
