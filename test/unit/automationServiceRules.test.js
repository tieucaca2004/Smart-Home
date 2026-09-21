'use strict';

/**
 * Unit tests for AutomationService with schema v2 (IF -> THEN rules): creation,
 * validation errors, the legacy-vs-rule guard on update, and list filtering.
 * In-memory store, fake scene service - no disk, no network.
 */

const assert = require('assert');
const AutomationService = require('../../src/services/automationService');
const JsonFileStore = require('../../src/storage/JsonFileStore');

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

function fakeSceneService() {
  return {
    async getScene(id) {
      if (id !== 'scene-1') {
        const err = new Error(`Scene "${id}" not found`);
        err.code = 'SCENE_NOT_FOUND';
        throw err;
      }
      return { id };
    },
  };
}

function makeService(options) {
  return new AutomationService(new JsonFileStore(), fakeSceneService(), options);
}

const legacyPayload = { name: 'Daily', enabled: true, trigger: { type: 'daily', time: '18:00' }, sceneId: 'scene-1' };
const rulePayload = {
  name: 'Door -> lamp',
  enabled: true,
  when: { type: 'and', conditions: [{ type: 'time', from: '11:00', to: '14:00' }, { type: 'door', deviceId: 'x:1', statusCode: 'contact', equals: true }] },
  then: [
    { type: 'command', deviceId: 'x:2', functionCode: 'switch_1', value: true },
    { type: 'scene', sceneId: 'scene-1' },
  ],
};

async function expectCode(promise, code, fragment) {
  await assert.rejects(promise, (err) => {
    assert.strictEqual(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (fragment) assert.ok(err.message.includes(fragment), `"${err.message}" should include "${fragment}"`);
    return true;
  });
}

async function run() {
  console.log('=== AutomationService (schema v2 rules) unit tests ===\n');

  await check('creates a valid rule: cleaned, schemaVersion 2, id/timestamps, no legacy keys', async () => {
    const service = makeService();
    const rule = await service.createAutomation({ ...rulePayload, name: '  Door -> lamp  ' });
    assert.strictEqual(rule.name, 'Door -> lamp');
    assert.strictEqual(rule.schemaVersion, 2);
    assert.ok(rule.id && rule.createdAt && rule.updatedAt);
    assert.strictEqual(rule.trigger, undefined);
    assert.strictEqual(rule.sceneId, undefined);
    assert.strictEqual(rule.when.type, 'and');
    assert.strictEqual(rule.then.length, 2);
    assert.deepStrictEqual(await service.getAutomation(rule.id), rule);
  });

  await check('legacy payload still creates a legacy record exactly as in Sprint 5 (no schemaVersion)', async () => {
    const service = makeService();
    const record = await service.createAutomation(legacyPayload);
    assert.deepStrictEqual(Object.keys(record).sort(), ['createdAt', 'enabled', 'id', 'name', 'sceneId', 'trigger', 'updatedAt']);
  });

  await check('validation: name, enabled, when, then problems -> VALIDATION_ERROR with paths', async () => {
    const service = makeService();
    await expectCode(service.createAutomation({ ...rulePayload, name: ' ' }), 'VALIDATION_ERROR', '"name"');
    await expectCode(service.createAutomation({ ...rulePayload, enabled: 'yes' }), 'VALIDATION_ERROR', '"enabled"');
    const noWhen = { ...rulePayload };
    delete noWhen.when;
    await expectCode(service.createAutomation(noWhen), 'VALIDATION_ERROR', 'when');
    const noThen = { ...rulePayload };
    delete noThen.then;
    await expectCode(service.createAutomation(noThen), 'VALIDATION_ERROR', 'then');
    await expectCode(service.createAutomation({ ...rulePayload, then: [] }), 'VALIDATION_ERROR', 'then');
    await expectCode(service.createAutomation({ ...rulePayload, when: { type: 'lunar' } }), 'VALIDATION_ERROR', 'when.type');
    await expectCode(
      service.createAutomation({ ...rulePayload, when: { type: 'and', conditions: [{ type: 'temperature', deviceId: 'd', statusCode: 'c', operator: '>', value: 'hot' }] } }),
      'VALIDATION_ERROR',
      'when.conditions[0].value must be a finite number'
    );
    await expectCode(
      service.createAutomation({ ...rulePayload, then: [{ type: 'command', deviceId: 'd', functionCode: 'c', value: 'on' }] }),
      'VALIDATION_ERROR',
      'then[0].value'
    );
  });

  await check('mixing v1 and v2 keys is rejected', async () => {
    const service = makeService();
    await expectCode(service.createAutomation({ ...rulePayload, sceneId: 'scene-1' }), 'VALIDATION_ERROR', 'mixes');
    await expectCode(service.createAutomation({ ...rulePayload, trigger: legacyPayload.trigger }), 'VALIDATION_ERROR', 'mixes');
    await expectCode(service.createAutomation({ ...legacyPayload, when: rulePayload.when }), 'VALIDATION_ERROR', 'mixes');
  });

  await check('a scene action naming a missing scene -> SCENE_NOT_FOUND', async () => {
    const service = makeService();
    await expectCode(
      service.createAutomation({ ...rulePayload, then: [{ type: 'scene', sceneId: 'ghost' }] }),
      'SCENE_NOT_FOUND'
    );
  });

  await check('a sun condition is rejected without a Hub location, accepted with one', async () => {
    const sunRule = { ...rulePayload, when: { type: 'sun', event: 'sunset', relation: 'after', offsetMinutes: -15 } };
    await expectCode(makeService().createAutomation(sunRule), 'VALIDATION_ERROR', 'HUB_LATITUDE');
    const located = makeService({ location: { latitude: 10, longitude: 106 } });
    const created = await located.createAutomation(sunRule);
    assert.deepStrictEqual(created.when, { type: 'sun', event: 'sunset', relation: 'after', offsetMinutes: -15 });
  });

  await check('PUT with a legacy payload onto a rule -> AUTOMATION_SCHEMA_MISMATCH and the rule is unchanged', async () => {
    const service = makeService();
    const rule = await service.createAutomation(rulePayload);
    await expectCode(service.updateAutomation(rule.id, { ...legacyPayload, enabled: false }), 'AUTOMATION_SCHEMA_MISMATCH');
    assert.deepStrictEqual(await service.getAutomation(rule.id), rule);
  });

  await check('PUT with a rule payload onto a rule replaces it fully and bumps updatedAt', async () => {
    const service = makeService();
    const rule = await service.createAutomation(rulePayload);
    await new Promise((r) => setTimeout(r, 5));
    const updated = await service.updateAutomation(rule.id, {
      name: 'Renamed', enabled: false, when: { type: 'time', at: '07:30' }, then: [{ type: 'command', deviceId: 'x:3', functionCode: 'switch_1', value: false }],
    });
    assert.strictEqual(updated.id, rule.id);
    assert.strictEqual(updated.createdAt, rule.createdAt);
    assert.notStrictEqual(updated.updatedAt, rule.updatedAt);
    assert.strictEqual(updated.name, 'Renamed');
    assert.strictEqual(updated.enabled, false);
    assert.deepStrictEqual(updated.when, { type: 'time', at: '07:30' });
    assert.strictEqual(updated.then.length, 1);
  });

  await check('PUT with a rule payload onto a legacy record upgrades it deliberately and drops trigger/sceneId', async () => {
    const service = makeService();
    const legacy = await service.createAutomation(legacyPayload);
    const upgraded = await service.updateAutomation(legacy.id, rulePayload);
    assert.strictEqual(upgraded.schemaVersion, 2);
    assert.strictEqual(upgraded.trigger, undefined);
    assert.strictEqual(upgraded.sceneId, undefined);
    assert.strictEqual(upgraded.createdAt, legacy.createdAt);
  });

  await check('PUT legacy onto legacy still behaves as in Sprint 5; unknown id -> AUTOMATION_NOT_FOUND', async () => {
    const service = makeService();
    const legacy = await service.createAutomation(legacyPayload);
    const toggled = await service.updateAutomation(legacy.id, { ...legacyPayload, enabled: false });
    assert.strictEqual(toggled.enabled, false);
    assert.deepStrictEqual(toggled.trigger, legacy.trigger);
    await expectCode(service.updateAutomation('nope', legacyPayload), 'AUTOMATION_NOT_FOUND');
    await expectCode(service.updateAutomation('nope', rulePayload), 'AUTOMATION_NOT_FOUND');
  });

  await check('listAutomations(): default hides rules (Sprint 5 contract); includeRules returns everything in order', async () => {
    const service = makeService();
    const a = await service.createAutomation(legacyPayload);
    const r = await service.createAutomation(rulePayload);
    const b = await service.createAutomation({ ...legacyPayload, name: 'Second' });
    assert.deepStrictEqual((await service.listAutomations()).map((x) => x.id), [a.id, b.id]);
    assert.deepStrictEqual((await service.listAutomations({})).map((x) => x.id), [a.id, b.id]);
    assert.deepStrictEqual((await service.listAutomations({ includeRules: true })).map((x) => x.id), [a.id, r.id, b.id]);
  });

  await check('delete works for rules; getAutomation returns a rule by id even though list hides it', async () => {
    const service = makeService();
    const rule = await service.createAutomation(rulePayload);
    assert.deepStrictEqual(await service.getAutomation(rule.id), rule);
    await service.deleteAutomation(rule.id);
    await expectCode(service.getAutomation(rule.id), 'AUTOMATION_NOT_FOUND');
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
