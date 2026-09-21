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

const act = (deviceId, functionCode, value) => ({ deviceId, functionCode, value });

/** Fake sleep that records the requested delays and never really waits. */
function fakeSleep() {
  const delays = [];
  return { delays, sleep: async (ms) => { delays.push(ms); } };
}

/**
 * Fake device service modelling propagation delay: after a command, the new
 * value only shows up in status reads after `lag[deviceId]` stale reads.
 * Records every send and every read.
 */
function makeLaggyDevice(opts = {}) {
  const { lag = {}, commandFailures = {}, readFailAlways = [], readFailFirst = [] } = opts;
  const state = {};
  const queued = {}; // deviceId -> [{ code, value, stale }]
  const sent = [];
  const reads = [];
  return {
    sent,
    reads,
    async sendCommand(deviceId, code, value) {
      sent.push({ deviceId, code, value });
      if (commandFailures[deviceId]) throw commandFailures[deviceId];
      state[deviceId] = state[deviceId] || {};
      const stale = lag[deviceId] || 0;
      if (stale > 0) {
        (queued[deviceId] = queued[deviceId] || []).push({ code, value, stale });
      } else {
        state[deviceId][code] = value;
      }
      return { accepted: true };
    },
    async getDeviceStatus(deviceId) {
      reads.push(deviceId);
      const nth = reads.filter((d) => d === deviceId).length;
      if (readFailAlways.includes(deviceId) || (readFailFirst.includes(deviceId) && nth === 1)) {
        throw new Error('read timeout');
      }
      state[deviceId] = state[deviceId] || {};
      queued[deviceId] = (queued[deviceId] || []).filter((q) => {
        if (q.stale > 0) {
          q.stale -= 1;
          return true;
        }
        state[deviceId][q.code] = q.value;
        return false;
      });
      return Object.entries(state[deviceId]).map(([code, value]) => ({ code, value }));
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

  // ---------------------------------------------------------------------
  // F-02: bounded re-verify after a stale immediate read-back (opt-in via
  // options.readBack). Fakes only; `sleep` is injected and never really waits.
  // ---------------------------------------------------------------------

  await check('F-02 stale-then-fresh: one shared wait + one re-read confirms the step; sent once; no error/code', async () => {
    const dev = makeLaggyDevice({ lag: { 'dev-a': 1 } });
    const sl = fakeSleep();
    const service = new SceneService(new JsonFileStore(), dev, { readBack: { sleep: sl.sleep } });
    const scene = await service.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });

    const result = await service.executeScene(scene.id);

    const step = result.results[0];
    assert.strictEqual(step.success, true);
    assert.strictEqual(step.status, 'success');
    assert.strictEqual(step.verifiedAfterRetry, true);
    assert.ok(!('error' in step) && !('code' in step));
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.verifiedAfterRetry, true);
    assert.strictEqual(dev.sent.length, 1); // never re-sent
    assert.deepStrictEqual(sl.delays, [2000]);
    assert.strictEqual(dev.reads.length, 2); // immediate + exactly one re-read
  });

  await check('F-02 still stale after the single re-read: step stays UNCONFIRMED / pending (not failed); no resend', async () => {
    const dev = makeLaggyDevice({ lag: { 'dev-a': 9 } });
    const sl = fakeSleep();
    const service = new SceneService(new JsonFileStore(), dev, { readBack: { sleep: sl.sleep } });
    const scene = await service.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });

    const result = await service.executeScene(scene.id);

    const step = result.results[0];
    assert.strictEqual(step.success, false);
    assert.strictEqual(step.code, 'UNCONFIRMED');
    assert.strictEqual(step.status, 'pending');
    assert.strictEqual(typeof step.error, 'string');
    assert.ok(!('verifiedAfterRetry' in step));
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'pending'); // NOT 'failed'
    assert.ok(!('verifiedAfterRetry' in result));
    assert.strictEqual(dev.sent.length, 1);
    assert.strictEqual(dev.reads.length, 2); // immediate + one re-read, no more
    assert.deepStrictEqual(sl.delays, [2000]);
  });

  await check('F-02 a real failure stays failed (code/error kept), is never re-read, and failed outranks pending', async () => {
    const offline = Object.assign(new Error('device is offline'), { appCode: 'DEVICE_OFFLINE' });
    const dev = makeLaggyDevice({ lag: { 'dev-b': 9 }, commandFailures: { 'dev-a': offline } });
    const sl = fakeSleep();
    const service = new SceneService(new JsonFileStore(), dev, { readBack: { sleep: sl.sleep } });
    const scene = await service.createScene({
      name: 'S',
      actions: [act('dev-a', 'switch_1', true), act('dev-b', 'switch_1', true)],
    });

    const result = await service.executeScene(scene.id);

    const [a, b] = result.results;
    assert.strictEqual(a.status, 'failed');
    assert.strictEqual(a.success, false);
    assert.strictEqual(a.code, 'DEVICE_OFFLINE');
    assert.strictEqual(a.error, 'device is offline');
    assert.strictEqual(b.status, 'pending');
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.success, false);
    assert.ok(!dev.reads.includes('dev-a')); // failed step: no read at all
    assert.strictEqual(dev.sent.length, 2);
    assert.deepStrictEqual(sl.delays, [2000]); // the pending step still gets its one shared wait
  });

  await check('F-02 a timeout-coded command failure is failed, not pending', async () => {
    const timeout = Object.assign(new Error('Device did not respond within 8000ms'), { appCode: 'DEVICE_TIMEOUT' });
    const dev = makeLaggyDevice({ commandFailures: { 'dev-a': timeout } });
    const sl = fakeSleep();
    const service = new SceneService(new JsonFileStore(), dev, { readBack: { sleep: sl.sleep } });
    const scene = await service.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });
    const result = await service.executeScene(scene.id);
    assert.strictEqual(result.results[0].status, 'failed');
    assert.strictEqual(result.results[0].code, 'DEVICE_TIMEOUT');
    assert.strictEqual(result.status, 'failed');
    assert.deepStrictEqual(sl.delays, []); // nothing pending -> no wait
  });

  await check('F-02 read failures never throw: both reads failing -> pending; immediate read failing but re-read ok -> success', async () => {
    const sl = fakeSleep();
    const bothFail = makeLaggyDevice({ readFailAlways: ['dev-a'] });
    const s1 = new SceneService(new JsonFileStore(), bothFail, { readBack: { sleep: sl.sleep } });
    const scene1 = await s1.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });
    const r1 = await s1.executeScene(scene1.id);
    assert.strictEqual(r1.results[0].code, 'UNCONFIRMED');
    assert.strictEqual(r1.results[0].status, 'pending');
    assert.strictEqual(r1.status, 'pending');
    assert.strictEqual(bothFail.sent.length, 1);

    const firstFails = makeLaggyDevice({ readFailFirst: ['dev-a'] });
    const s2 = new SceneService(new JsonFileStore(), firstFails, { readBack: { sleep: sl.sleep } });
    const scene2 = await s2.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });
    const r2 = await s2.executeScene(scene2.id);
    assert.strictEqual(r2.results[0].success, true);
    assert.strictEqual(r2.results[0].verifiedAfterRetry, true);
    assert.strictEqual(r2.status, 'success');
    assert.strictEqual(firstFails.sent.length, 1);
  });

  await check('F-02 mixed multi-step scene: ONE shared wait, one re-read per distinct pending device, order kept, no resend', async () => {
    const offline = Object.assign(new Error('device is offline'), { appCode: 'DEVICE_OFFLINE' });
    const dev = makeLaggyDevice({ lag: { 'dev-a': 1, 'dev-b': 9 }, commandFailures: { 'dev-d': offline } });
    const sl = fakeSleep();
    const service = new SceneService(new JsonFileStore(), dev, { readBack: { sleep: sl.sleep } });
    const scene = await service.createScene({
      name: 'Mixed',
      actions: [
        act('dev-a', 'switch_1', true), // stale -> confirmed by the re-read
        act('dev-b', 'switch_1', true), // stale -> still stale
        act('dev-c', 'switch_1', true), // confirmed at once
        act('dev-d', 'switch_1', true), // rejected
        act('dev-a', 'switch_2', true), // same device as step 1 -> shares its single re-read
      ],
    });

    const result = await service.executeScene(scene.id);

    assert.deepStrictEqual(result.results.map((r) => r.status), ['success', 'pending', 'success', 'failed', 'success']);
    assert.deepStrictEqual(result.results.map((r) => Boolean(r.verifiedAfterRetry)), [true, false, false, false, true]);
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.verifiedAfterRetry, true);
    assert.deepStrictEqual(dev.sent.map((c) => `${c.deviceId}/${c.code}`), [
      'dev-a/switch_1', 'dev-b/switch_1', 'dev-c/switch_1', 'dev-d/switch_1', 'dev-a/switch_2',
    ]);
    assert.strictEqual(dev.sent.length, 5); // exactly one send per step
    assert.deepStrictEqual(sl.delays, [2000]); // one wait for the whole scene
    // 4 immediate reads (dev-d never read) + one re-read for each of the 2 distinct pending devices
    assert.strictEqual(dev.reads.length, 6);
    assert.deepStrictEqual(dev.reads.slice(4).sort(), ['dev-a', 'dev-b']);
  });

  await check('F-02 total wait does not depend on the number of pending steps (6 pending steps -> one sleep, 6 re-reads)', async () => {
    const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    const lag = Object.fromEntries(ids.map((i) => [i, 1]));
    const dev = makeLaggyDevice({ lag });
    const sl = fakeSleep();
    const service = new SceneService(new JsonFileStore(), dev, { readBack: { sleep: sl.sleep } });
    const scene = await service.createScene({ name: 'Big', actions: ids.map((i) => act(i, 'switch_1', true)) });
    const result = await service.executeScene(scene.id);
    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(sl.delays, [2000]);
    assert.strictEqual(dev.reads.length, 12);
    assert.strictEqual(dev.sent.length, 6);
  });

  await check('F-02 nothing pending -> no wait, no extra read; readBack not configured -> original behaviour (UNCONFIRMED at once, no wait)', async () => {
    const sl = fakeSleep();
    const ok = makeLaggyDevice();
    const withReadBack = new SceneService(new JsonFileStore(), ok, { readBack: { sleep: sl.sleep } });
    const sceneOk = await withReadBack.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });
    const rOk = await withReadBack.executeScene(sceneOk.id);
    assert.strictEqual(rOk.status, 'success');
    assert.ok(!('verifiedAfterRetry' in rOk) && !('verifiedAfterRetry' in rOk.results[0]));
    assert.deepStrictEqual(sl.delays, []);
    assert.strictEqual(ok.reads.length, 1);

    for (const options of [undefined, {}, { readBack: null }, { readBack: 'yes' }]) {
      const plain = makeLaggyDevice({ lag: { 'dev-a': 1 } });
      const svc = new SceneService(new JsonFileStore(), plain, options);
      assert.strictEqual(svc.readBack, null);
      const sc = await svc.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });
      const r = await svc.executeScene(sc.id);
      assert.strictEqual(r.results[0].code, 'UNCONFIRMED');
      assert.strictEqual(r.results[0].status, 'pending');
      assert.strictEqual(plain.reads.length, 1); // immediate read only
    }
  });

  await check('F-02 a throwing sleep is swallowed (still re-reads); retryDelayMs is clamped to 0..5000, wrong types -> 2000', async () => {
    const dev = makeLaggyDevice({ lag: { 'dev-a': 1 } });
    const service = new SceneService(new JsonFileStore(), dev, {
      readBack: { sleep: async () => { throw new Error('sleep broke'); } },
    });
    const scene = await service.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });
    const result = await service.executeScene(scene.id);
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(dev.reads.length, 2);

    const delayFor = (retryDelayMs) => new SceneService(new JsonFileStore(), makeLaggyDevice(), { readBack: { retryDelayMs } }).readBack.retryDelayMs;
    assert.strictEqual(delayFor(99999), 5000);
    assert.strictEqual(delayFor(-5), 0);
    assert.strictEqual(delayFor(750), 750);
    assert.strictEqual(delayFor('fast'), 2000);
    assert.strictEqual(delayFor(undefined), 2000);

    const sl = fakeSleep();
    const staleDev = makeLaggyDevice({ lag: { 'dev-a': 1 } });
    const custom = new SceneService(new JsonFileStore(), staleDev, { readBack: { retryDelayMs: 250, sleep: sl.sleep } });
    const sc = await custom.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });
    await custom.executeScene(sc.id);
    assert.deepStrictEqual(sl.delays, [250]);
  });

  await check('F-02 wiring: the production bootstrap enables the re-read (default 2000 ms, real sleep)', async () => {
    const { buildScenesAndAutomations } = require('../../src/bootstrap');
    const { sceneService } = buildScenesAndAutomations(makeLaggyDevice()); // stores are lazy: no data file is read
    assert.ok(sceneService.readBack);
    assert.strictEqual(sceneService.readBack.retryDelayMs, 2000);
    assert.strictEqual(typeof sceneService.readBack.sleep, 'function');
  });

  await check('F-02 legacy scheduler: a propagation delay now logs "success"; a step still pending afterwards keeps "partial failure"', async () => {
    const AutomationScheduler = require('../../src/services/AutomationScheduler');
    const at = new Date(2026, 0, 15, 18, 0, 0);
    const runOnce = async (lag) => {
      const dev = makeLaggyDevice({ lag: { 'dev-a': lag } });
      const sl = fakeSleep();
      const scenes = new SceneService(new JsonFileStore(), dev, { readBack: { sleep: sl.sleep } });
      const scene = await scenes.createScene({ name: 'Evening', actions: [act('dev-a', 'switch_1', true)] });
      const lines = [];
      const scheduler = new AutomationScheduler(
        { async listAutomations() { return [{ id: 'a1', name: 'Auto', enabled: true, trigger: { type: 'daily', time: '18:00' }, sceneId: scene.id }]; } },
        scenes,
        { now: () => at, log: { log: (m) => lines.push(m), error: (m) => lines.push(m) } }
      );
      await scheduler.tick();
      return { lines, dev };
    };

    const fresh = await runOnce(1);
    assert.strictEqual(fresh.lines.length, 1);
    assert.ok(fresh.lines[0].endsWith(': success'), fresh.lines[0]);
    assert.ok(!fresh.lines[0].includes('partial failure'));
    assert.strictEqual(fresh.dev.sent.length, 1);

    const stuck = await runOnce(9);
    assert.ok(stuck.lines[0].endsWith(': partial failure'), stuck.lines[0]); // unchanged behaviour (log only)
    assert.strictEqual(stuck.dev.sent.length, 1);
  });

  await check('F-02 rule scene action over the real SceneService: stale-then-fresh -> success with ONE wait (no double delay); stale twice -> action re-reads once; never resends', async () => {
    const createDefaultRegistries = require('../../src/automation/createDefaultRegistries');
    const run = async (lag) => {
      const dev = makeLaggyDevice({ lag: { 'dev-a': lag } });
      const sceneSleep = fakeSleep();
      const actionSleep = fakeSleep();
      const sceneService = new SceneService(new JsonFileStore(), dev, { readBack: { sleep: sceneSleep.sleep } });
      const scene = await sceneService.createScene({ name: 'S', actions: [act('dev-a', 'switch_1', true)] });
      const { actionRegistry } = createDefaultRegistries({ deviceService: dev, sceneService });
      const result = await actionRegistry.execute(
        { type: 'scene', sceneId: scene.id },
        { verify: { retryDelayMs: 2000, sleep: actionSleep.sleep } }
      );
      return { result, dev, sceneSleep, actionSleep };
    };

    const one = await run(1); // SceneService's own re-read confirms it
    assert.strictEqual(one.result.status, 'success');
    assert.deepStrictEqual(one.sceneSleep.delays, [2000]);
    assert.deepStrictEqual(one.actionSleep.delays, []); // the action did not wait again
    assert.strictEqual(one.dev.sent.length, 1);

    const two = await run(2); // SceneService still pending -> the action's own single re-read confirms it
    assert.strictEqual(two.result.status, 'success');
    assert.deepStrictEqual(two.sceneSleep.delays, [2000]);
    assert.deepStrictEqual(two.actionSleep.delays, [2000]);
    assert.strictEqual(two.dev.sent.length, 1); // still sent exactly once
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
