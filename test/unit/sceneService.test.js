'use strict';

/**
 * Unit tests for SceneService: CRUD validation, and execution (success,
 * partial failure, unconfirmed value, rejected command). Uses a small fake
 * DeviceService (just the two methods SceneService actually calls) — no
 * network, no real Tuya credentials, no dependency on TuyaAdapter.
 */

const assert = require('assert');
const JsonFileStore = require('../../src/storage/JsonFileStore');
const SceneService = require('../../src/services/sceneService');

/**
 * @param {{commandFailures?: Record<string, Error>, statuses?: Record<string, Array<{code:string,value:*}>>, statusFailures?: Record<string, Error>}} opts
 */
function makeFakeDeviceService(opts = {}) {
  const { commandFailures = {}, statuses = {}, statusFailures = {} } = opts;
  const sentCommands = [];
  return {
    sentCommands,
    async sendCommand(deviceId, code, value) {
      sentCommands.push({ deviceId, code, value });
      if (commandFailures[deviceId]) throw commandFailures[deviceId];
      return { accepted: true };
    },
    async getDeviceStatus(deviceId) {
      if (statusFailures[deviceId]) throw statusFailures[deviceId];
      return statuses[deviceId] || [];
    },
  };
}

const validPayload = {
  name: 'Tắt toàn bộ quán',
  icon: 'power-off',
  actions: [
    { deviceId: 'tuya:light-1', functionCode: 'switch_1', value: false },
    { deviceId: 'tuya:gate-1', functionCode: 'switch_led', value: false },
  ],
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
    console.log(`      ${err.stack || err.message}`);
    failCount += 1;
  }
}

async function run() {
  console.log('=== SceneService unit tests ===\n');

  await check('createScene() saves a scene with a generated id and timestamps', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    const scene = await service.createScene(validPayload);
    assert.strictEqual(typeof scene.id, 'string');
    assert.ok(scene.id.length > 0);
    assert.strictEqual(scene.name, 'Tắt toàn bộ quán');
    assert.strictEqual(scene.icon, 'power-off');
    assert.strictEqual(scene.actions.length, 2);
    assert.strictEqual(typeof scene.createdAt, 'string');
    assert.strictEqual(scene.createdAt, scene.updatedAt);
  });

  await check('createScene() defaults icon to "custom" when omitted', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    const scene = await service.createScene({ name: 'X', actions: validPayload.actions });
    assert.strictEqual(scene.icon, 'custom');
  });

  await check('createScene() rejects a missing name', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    await assert.rejects(
      () => service.createScene({ actions: validPayload.actions }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  });

  await check('createScene() rejects an empty actions array', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    await assert.rejects(
      () => service.createScene({ name: 'X', actions: [] }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  });

  await check('createScene() rejects an action with a non-boolean value (MVP: Boolean only)', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    await assert.rejects(
      () =>
        service.createScene({
          name: 'X',
          actions: [{ deviceId: 'tuya:a', functionCode: 'level', value: 42 }],
        }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  });

  await check('createScene() rejects an action missing deviceId/functionCode', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    await assert.rejects(
      () => service.createScene({ name: 'X', actions: [{ value: true }] }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  });

  await check('createScene() rejects an unknown icon key', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    await assert.rejects(
      () => service.createScene({ ...validPayload, icon: 'not-a-real-icon' }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  });

  await check('listScenes() returns every saved scene', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    await service.createScene(validPayload);
    await service.createScene({ ...validPayload, name: 'Mở quán' });
    const scenes = await service.listScenes();
    assert.strictEqual(scenes.length, 2);
  });

  await check('getScene() returns the scene by id', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    const created = await service.createScene(validPayload);
    const found = await service.getScene(created.id);
    assert.deepStrictEqual(found, created);
  });

  await check('getScene() with an unknown id throws SCENE_NOT_FOUND', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    await assert.rejects(
      () => service.getScene('nope'),
      (err) => err.code === 'SCENE_NOT_FOUND'
    );
  });

  await check('updateScene() replaces the scene and bumps updatedAt', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    const created = await service.createScene(validPayload);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const updated = await service.updateScene(created.id, { ...validPayload, name: 'Renamed' });
    assert.strictEqual(updated.id, created.id);
    assert.strictEqual(updated.name, 'Renamed');
    assert.strictEqual(updated.createdAt, created.createdAt);
    assert.notStrictEqual(updated.updatedAt, created.updatedAt);
  });

  await check('updateScene() with an unknown id throws SCENE_NOT_FOUND', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    await assert.rejects(
      () => service.updateScene('nope', validPayload),
      (err) => err.code === 'SCENE_NOT_FOUND'
    );
  });

  await check('deleteScene() removes it; a second delete throws SCENE_NOT_FOUND', async () => {
    const service = new SceneService(new JsonFileStore(), makeFakeDeviceService());
    const created = await service.createScene(validPayload);
    await service.deleteScene(created.id);
    assert.strictEqual((await service.listScenes()).length, 0);
    await assert.rejects(
      () => service.deleteScene(created.id),
      (err) => err.code === 'SCENE_NOT_FOUND'
    );
  });

  await check('executeScene() with an unknown id throws SCENE_NOT_FOUND, sends nothing', async () => {
    const deviceService = makeFakeDeviceService();
    const service = new SceneService(new JsonFileStore(), deviceService);
    await assert.rejects(
      () => service.executeScene('nope'),
      (err) => err.code === 'SCENE_NOT_FOUND'
    );
    assert.strictEqual(deviceService.sentCommands.length, 0);
  });

  await check('executeScene() sends every action, in order, and reports overall success when the device confirms', async () => {
    const deviceService = makeFakeDeviceService({
      statuses: {
        'tuya:light-1': [{ code: 'switch_1', value: false }],
        'tuya:gate-1': [{ code: 'switch_led', value: false }],
      },
    });
    const service = new SceneService(new JsonFileStore(), deviceService);
    const scene = await service.createScene(validPayload);

    const result = await service.executeScene(scene.id);

    assert.strictEqual(result.sceneId, scene.id);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.results.length, 2);
    assert.ok(result.results.every((r) => r.success === true));
    assert.deepStrictEqual(
      deviceService.sentCommands.map((c) => c.deviceId),
      ['tuya:light-1', 'tuya:gate-1']
    );
  });

  await check('executeScene() reports scene failure and identifies the device when a command is rejected', async () => {
    const offlineErr = Object.assign(new Error('device is offline'), { appCode: 'DEVICE_OFFLINE' });
    const deviceService = makeFakeDeviceService({
      commandFailures: { 'tuya:gate-1': offlineErr },
      statuses: { 'tuya:light-1': [{ code: 'switch_1', value: false }] },
    });
    const service = new SceneService(new JsonFileStore(), deviceService);
    const scene = await service.createScene(validPayload);

    const result = await service.executeScene(scene.id);

    assert.strictEqual(result.success, false);
    const light = result.results.find((r) => r.deviceId === 'tuya:light-1');
    const gate = result.results.find((r) => r.deviceId === 'tuya:gate-1');
    assert.strictEqual(light.success, true);
    assert.strictEqual(gate.success, false);
    assert.strictEqual(gate.code, 'DEVICE_OFFLINE');
  });

  await check('executeScene() does not stop at the first failure — every action is still attempted', async () => {
    const err = Object.assign(new Error('boom'), { appCode: 'UPSTREAM_ERROR' });
    const deviceService = makeFakeDeviceService({
      commandFailures: { 'tuya:light-1': err },
      statuses: { 'tuya:gate-1': [{ code: 'switch_led', value: false }] },
    });
    const service = new SceneService(new JsonFileStore(), deviceService);
    const scene = await service.createScene(validPayload);

    await service.executeScene(scene.id);

    assert.deepStrictEqual(
      deviceService.sentCommands.map((c) => c.deviceId),
      ['tuya:light-1', 'tuya:gate-1']
    );
  });

  await check('executeScene() treats a command that the device never confirms as a failed action', async () => {
    const deviceService = makeFakeDeviceService({
      statuses: {
        'tuya:light-1': [{ code: 'switch_1', value: true }], // still the old value
        'tuya:gate-1': [{ code: 'switch_led', value: false }],
      },
    });
    const service = new SceneService(new JsonFileStore(), deviceService);
    const scene = await service.createScene(validPayload); // asks for switch_1 = false

    const result = await service.executeScene(scene.id);

    const light = result.results.find((r) => r.deviceId === 'tuya:light-1');
    assert.strictEqual(light.success, false);
    assert.strictEqual(light.code, 'UNCONFIRMED');
    assert.strictEqual(result.success, false);
  });

  await check('executeScene() treats a failed status read-back as unconfirmed, not a crash', async () => {
    const statusErr = new Error('status endpoint down');
    const deviceService = makeFakeDeviceService({
      statusFailures: { 'tuya:light-1': statusErr },
      statuses: { 'tuya:gate-1': [{ code: 'switch_led', value: false }] },
    });
    const service = new SceneService(new JsonFileStore(), deviceService);
    const scene = await service.createScene(validPayload);

    const result = await service.executeScene(scene.id);

    const light = result.results.find((r) => r.deviceId === 'tuya:light-1');
    assert.strictEqual(light.success, false);
    assert.strictEqual(light.code, 'UNCONFIRMED');
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
