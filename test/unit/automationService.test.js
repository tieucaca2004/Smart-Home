'use strict';

/**
 * Unit tests for AutomationService: CRUD validation, including that
 * `sceneId` must name a scene that actually exists.
 */

const assert = require('assert');
const JsonFileStore = require('../../src/storage/JsonFileStore');
const SceneService = require('../../src/services/sceneService');
const AutomationService = require('../../src/services/automationService');

function makeFakeDeviceService() {
  return {
    async sendCommand() {
      return { accepted: true };
    },
    async getDeviceStatus() {
      return [];
    },
  };
}

async function makeServices() {
  const sceneService = new SceneService(new JsonFileStore(), makeFakeDeviceService());
  const scene = await sceneService.createScene({
    name: 'Mở quán',
    actions: [{ deviceId: 'tuya:light-1', functionCode: 'switch_1', value: true }],
  });
  const automationService = new AutomationService(new JsonFileStore(), sceneService);
  return { sceneService, automationService, scene };
}

const validPayload = (sceneId) => ({
  name: 'Mở quán lúc 18:00',
  enabled: true,
  trigger: { type: 'daily', time: '18:00' },
  sceneId,
});

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
  console.log('=== AutomationService unit tests ===\n');

  await check('createAutomation() saves an automation with a generated id', async () => {
    const { automationService, scene } = await makeServices();
    const automation = await automationService.createAutomation(validPayload(scene.id));
    assert.strictEqual(typeof automation.id, 'string');
    assert.strictEqual(automation.name, 'Mở quán lúc 18:00');
    assert.strictEqual(automation.enabled, true);
    assert.deepStrictEqual(automation.trigger, { type: 'daily', time: '18:00' });
    assert.strictEqual(automation.sceneId, scene.id);
  });

  await check('createAutomation() rejects an unknown sceneId with SCENE_NOT_FOUND', async () => {
    const { automationService } = await makeServices();
    await assert.rejects(
      () => automationService.createAutomation(validPayload('no-such-scene')),
      (err) => err.code === 'SCENE_NOT_FOUND'
    );
  });

  await check('createAutomation() rejects a missing "enabled"', async () => {
    const { automationService, scene } = await makeServices();
    const payload = validPayload(scene.id);
    delete payload.enabled;
    await assert.rejects(
      () => automationService.createAutomation(payload),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  });

  await check('createAutomation() rejects a trigger type other than "daily"', async () => {
    const { automationService, scene } = await makeServices();
    await assert.rejects(
      () =>
        automationService.createAutomation({
          ...validPayload(scene.id),
          trigger: { type: 'sunset' },
        }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  });

  await check('createAutomation() rejects a malformed time', async () => {
    const { automationService, scene } = await makeServices();
    for (const time of ['25:00', '9:00', '18:60', 'evening', '']) {
      await assert.rejects(
        () =>
          automationService.createAutomation({
            ...validPayload(scene.id),
            trigger: { type: 'daily', time },
          }),
        (err) => err.code === 'VALIDATION_ERROR',
        `time "${time}" should have been rejected`
      );
    }
  });

  await check('createAutomation() accepts a valid boundary time ("00:00" and "23:59")', async () => {
    const { automationService, scene } = await makeServices();
    for (const time of ['00:00', '23:59']) {
      const automation = await automationService.createAutomation({
        ...validPayload(scene.id),
        trigger: { type: 'daily', time },
      });
      assert.strictEqual(automation.trigger.time, time);
    }
  });

  await check('listAutomations() returns every saved automation', async () => {
    const { automationService, scene } = await makeServices();
    await automationService.createAutomation(validPayload(scene.id));
    await automationService.createAutomation({ ...validPayload(scene.id), name: 'Second' });
    assert.strictEqual((await automationService.listAutomations()).length, 2);
  });

  await check('getAutomation() with an unknown id throws AUTOMATION_NOT_FOUND', async () => {
    const { automationService } = await makeServices();
    await assert.rejects(
      () => automationService.getAutomation('nope'),
      (err) => err.code === 'AUTOMATION_NOT_FOUND'
    );
  });

  await check('updateAutomation() can flip enabled off', async () => {
    const { automationService, scene } = await makeServices();
    const created = await automationService.createAutomation(validPayload(scene.id));
    const updated = await automationService.updateAutomation(created.id, {
      ...validPayload(scene.id),
      enabled: false,
    });
    assert.strictEqual(updated.enabled, false);
    assert.strictEqual(updated.id, created.id);
  });

  await check('updateAutomation() with an unknown id throws AUTOMATION_NOT_FOUND', async () => {
    const { automationService, scene } = await makeServices();
    await assert.rejects(
      () => automationService.updateAutomation('nope', validPayload(scene.id)),
      (err) => err.code === 'AUTOMATION_NOT_FOUND'
    );
  });

  await check('deleteAutomation() removes it; a second delete throws AUTOMATION_NOT_FOUND', async () => {
    const { automationService, scene } = await makeServices();
    const created = await automationService.createAutomation(validPayload(scene.id));
    await automationService.deleteAutomation(created.id);
    assert.strictEqual((await automationService.listAutomations()).length, 0);
    await assert.rejects(
      () => automationService.deleteAutomation(created.id),
      (err) => err.code === 'AUTOMATION_NOT_FOUND'
    );
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
