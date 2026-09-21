'use strict';

/**
 * API tests for /api/automations — in-process HTTP, no real Tuya network
 * calls. Reuses the same default (in-memory) wiring createApp(deviceService)
 * falls back to, so /api/scenes and /api/automations share one sceneService
 * exactly as they do in production.
 */

const http = require('http');
const assert = require('assert');
const createApp = require('../../src/app');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceAdapter = require('../../src/adapters/DeviceAdapter');
const DeviceService = require('../../src/services/deviceService');

class FakeTuyaAdapter extends DeviceAdapter {
  get protocol() {
    return 'tuya';
  }
  async getDevices() {
    return [{ id: 'tuya:fake1', nativeId: 'fake1', protocol: 'tuya', name: 'Fake Switch', online: true }];
  }
  async getDeviceStatus() {
    return [{ code: 'switch_1', value: false }];
  }
  async sendCommand() {
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
        res.on('data', (chunk) => { raw += chunk; });
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
  console.log('=== Automations API tests (in-process, no real Tuya network calls) ===\n');

  const app = buildTestApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const scene = (
    await requestJson(server, 'POST', '/api/scenes', {
      name: 'Mở quán',
      actions: [{ deviceId: 'tuya:fake1', functionCode: 'switch_1', value: true }],
    })
  ).body.scene;

  const automationPayload = {
    name: 'Mở quán lúc 18:00',
    enabled: true,
    trigger: { type: 'daily', time: '18:00' },
    sceneId: scene.id,
  };

  await check('GET /api/automations starts empty', async () => {
    const res = await requestJson(server, 'GET', '/api/automations');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.automations, []);
  });

  await check('POST /api/automations creates an automation and returns 201', async () => {
    const res = await requestJson(server, 'POST', '/api/automations', automationPayload);
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.automation.name, automationPayload.name);
    assert.strictEqual(res.body.automation.sceneId, scene.id);
  });

  await check('POST /api/automations with an unknown sceneId returns 404 SCENE_NOT_FOUND', async () => {
    const res = await requestJson(server, 'POST', '/api/automations', {
      ...automationPayload,
      sceneId: 'does-not-exist',
    });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'SCENE_NOT_FOUND');
  });

  await check('POST /api/automations with a malformed time returns 400 VALIDATION_ERROR', async () => {
    const res = await requestJson(server, 'POST', '/api/automations', {
      ...automationPayload,
      trigger: { type: 'daily', time: '9:00' },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
  });

  const created = (await requestJson(server, 'POST', '/api/automations', { ...automationPayload, name: 'Second' })).body
    .automation;

  await check('GET /api/automations lists the created automations', async () => {
    const res = await requestJson(server, 'GET', '/api/automations');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.automations.length, 2);
  });

  await check('GET /api/automations/:id returns that automation', async () => {
    const res = await requestJson(server, 'GET', `/api/automations/${created.id}`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.automation.id, created.id);
  });

  await check('GET /api/automations/:id with an unknown id returns 404 AUTOMATION_NOT_FOUND', async () => {
    const res = await requestJson(server, 'GET', '/api/automations/does-not-exist');
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'AUTOMATION_NOT_FOUND');
  });

  await check('PUT /api/automations/:id can disable it', async () => {
    const res = await requestJson(server, 'PUT', `/api/automations/${created.id}`, {
      ...automationPayload,
      enabled: false,
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.automation.enabled, false);
  });

  await check('PUT /api/automations/:id with an unknown id returns 404 AUTOMATION_NOT_FOUND', async () => {
    const res = await requestJson(server, 'PUT', '/api/automations/does-not-exist', automationPayload);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'AUTOMATION_NOT_FOUND');
  });

  await check('DELETE /api/automations/:id removes it (204), then 404s', async () => {
    const del = await requestJson(server, 'DELETE', `/api/automations/${created.id}`);
    assert.strictEqual(del.statusCode, 204);
    const get = await requestJson(server, 'GET', `/api/automations/${created.id}`);
    assert.strictEqual(get.statusCode, 404);
  });

  await check('DELETE /api/automations/:id with an unknown id returns 404 AUTOMATION_NOT_FOUND', async () => {
    const res = await requestJson(server, 'DELETE', '/api/automations/does-not-exist');
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'AUTOMATION_NOT_FOUND');
  });

  await new Promise((resolve) => server.close(resolve));

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
