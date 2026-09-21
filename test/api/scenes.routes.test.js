'use strict';

/**
 * API tests for /api/scenes — in-process HTTP calls against the Express
 * app, reusing the same FakeTuyaAdapter idea as test/api/devices.routes.test.js
 * (no real Tuya network calls). Exercises the default (in-memory) wiring
 * createApp(deviceService) falls back to when no sceneService is injected,
 * since that is exactly what production code does not use but tests may.
 */

const http = require('http');
const assert = require('assert');
const createApp = require('../../src/app');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceAdapter = require('../../src/adapters/DeviceAdapter');
const DeviceService = require('../../src/services/deviceService');

const SIMULATED_ERRORS = { 'offline-device': 'DEVICE_OFFLINE' };

class FakeTuyaAdapter extends DeviceAdapter {
  get protocol() {
    return 'tuya';
  }

  async getDevices() {
    return [{ id: 'tuya:fake1', nativeId: 'fake1', protocol: 'tuya', name: 'Fake Switch', online: true }];
  }

  async getDeviceStatus(nativeId) {
    if (SIMULATED_ERRORS[nativeId]) throw Object.assign(new Error('simulated'), { appCode: SIMULATED_ERRORS[nativeId] });
    return [{ code: 'switch_1', value: false }];
  }

  async sendCommand(nativeId, code, value) {
    if (SIMULATED_ERRORS[nativeId]) throw Object.assign(new Error('simulated'), { appCode: SIMULATED_ERRORS[nativeId] });
    return true;
  }
}

function buildTestApp() {
  const registry = new AdapterRegistry();
  registry.register(new FakeTuyaAdapter());
  const service = new DeviceService(registry);
  return createApp(service); // no sceneService/automationService injected: exercises the default wiring
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

const scenePayload = {
  name: 'Tắt toàn bộ quán',
  icon: 'power-off',
  actions: [{ deviceId: 'tuya:fake1', functionCode: 'switch_1', value: false }],
};

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
  console.log('=== Scenes API tests (in-process, no real Tuya network calls) ===\n');

  const app = buildTestApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  await check('GET /api/scenes starts empty', async () => {
    const res = await requestJson(server, 'GET', '/api/scenes');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.scenes, []);
  });

  await check('POST /api/scenes creates a scene and returns 201', async () => {
    const res = await requestJson(server, 'POST', '/api/scenes', scenePayload);
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.scene.name, scenePayload.name);
    assert.strictEqual(typeof res.body.scene.id, 'string');
  });

  await check('POST /api/scenes with no actions returns 400 VALIDATION_ERROR', async () => {
    const res = await requestJson(server, 'POST', '/api/scenes', { name: 'Empty', actions: [] });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
  });

  await check('POST /api/scenes with a non-boolean action value returns 400 VALIDATION_ERROR', async () => {
    const res = await requestJson(server, 'POST', '/api/scenes', {
      name: 'Bad',
      actions: [{ deviceId: 'tuya:fake1', functionCode: 'level', value: 5 }],
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
  });

  await check('GET /api/scenes lists the created scene', async () => {
    const res = await requestJson(server, 'GET', '/api/scenes');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.scenes.length, 1);
  });

  const created = (await requestJson(server, 'POST', '/api/scenes', { ...scenePayload, name: 'Second' })).body.scene;

  await check('GET /api/scenes/:id returns that scene', async () => {
    const res = await requestJson(server, 'GET', `/api/scenes/${created.id}`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.scene.id, created.id);
  });

  await check('GET /api/scenes/:id with an unknown id returns 404 SCENE_NOT_FOUND', async () => {
    const res = await requestJson(server, 'GET', '/api/scenes/does-not-exist');
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'SCENE_NOT_FOUND');
  });

  await check('PUT /api/scenes/:id updates the scene', async () => {
    const res = await requestJson(server, 'PUT', `/api/scenes/${created.id}`, {
      ...scenePayload,
      name: 'Renamed',
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.scene.name, 'Renamed');
  });

  await check('PUT /api/scenes/:id with an unknown id returns 404 SCENE_NOT_FOUND', async () => {
    const res = await requestJson(server, 'PUT', '/api/scenes/does-not-exist', scenePayload);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'SCENE_NOT_FOUND');
  });

  await check('POST /api/scenes/:id/execute succeeds when the device confirms the value', async () => {
    const res = await requestJson(server, 'POST', `/api/scenes/${created.id}/execute`, {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.results[0].success, true);
  });

  await check('POST /api/scenes/:id/execute reports per-action failure (never a 5xx) when a device is offline', async () => {
    const offlineScene = (
      await requestJson(server, 'POST', '/api/scenes', {
        name: 'Offline test',
        actions: [{ deviceId: 'tuya:offline-device', functionCode: 'switch_1', value: true }],
      })
    ).body.scene;

    const res = await requestJson(server, 'POST', `/api/scenes/${offlineScene.id}/execute`, {});

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.results[0].success, false);
    assert.strictEqual(res.body.results[0].code, 'DEVICE_OFFLINE');
  });

  await check('POST /api/scenes/:id/execute with an unknown id returns 404 SCENE_NOT_FOUND', async () => {
    const res = await requestJson(server, 'POST', '/api/scenes/does-not-exist/execute', {});
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'SCENE_NOT_FOUND');
  });

  await check('DELETE /api/scenes/:id removes it (204), then 404s', async () => {
    const del = await requestJson(server, 'DELETE', `/api/scenes/${created.id}`);
    assert.strictEqual(del.statusCode, 204);
    const get = await requestJson(server, 'GET', `/api/scenes/${created.id}`);
    assert.strictEqual(get.statusCode, 404);
  });

  await check('DELETE /api/scenes/:id with an unknown id returns 404 SCENE_NOT_FOUND', async () => {
    const res = await requestJson(server, 'DELETE', '/api/scenes/does-not-exist');
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'SCENE_NOT_FOUND');
  });

  await new Promise((resolve) => server.close(resolve));

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
