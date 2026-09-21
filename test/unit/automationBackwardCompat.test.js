'use strict';

/**
 * Backward-compatibility of Sprint 6 with real Sprint 5 data.
 *
 * Uses test/fixtures/sprint5-automations.json (a copy of the shape/content of
 * a real Sprint 5 data/automations.json). The fixture is COPIED into a fresh
 * temp directory first; nothing here reads or writes the repo's data/ folder.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AutomationService = require('../../src/services/automationService');
const AutomationScheduler = require('../../src/services/AutomationScheduler');
const JsonFileStore = require('../../src/storage/JsonFileStore');
const RuleEngine = require('../../src/automation/RuleEngine');
const createDefaultRegistries = require('../../src/automation/createDefaultRegistries');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'sprint5-automations.json');
const SCENE_ID = '55eb9b7d-5132-4876-8581-bdf7c3114f43';
const silent = { log: () => {}, error: () => {}, warn: () => {} };

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

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Fresh temp copy of the fixture + wired services. */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tieu-hub-bc-'));
  const file = path.join(dir, 'automations.json');
  fs.copyFileSync(FIXTURE, file);
  const executed = [];
  const sceneService = {
    async getScene(id) {
      if (id !== SCENE_ID) { const e = new Error('nf'); e.code = 'SCENE_NOT_FOUND'; throw e; }
      return { id };
    },
    async executeScene(id) { executed.push(id); return { success: true, sceneName: 'S', results: [] }; },
  };
  const deviceService = {
    async getDeviceStatus() { return [{ code: 'contact', value: false }]; },
    async sendCommand() { return true; },
  };
  const registries = createDefaultRegistries({ deviceService, sceneService });
  const service = new AutomationService(new JsonFileStore(file), sceneService, registries);
  const ruleEngine = new RuleEngine({ deviceService, ...registries, log: silent });
  const scheduler = (now) => new AutomationScheduler(service, sceneService, { now: () => now, log: silent, ruleEngine });
  return { dir, file, service, sceneService, executed, scheduler };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function run() {
  console.log('=== Sprint 5 -> Sprint 6 backward compatibility (fixture copied to a temp dir) ===\n');
  const fixtureRecords = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const fixtureHashBefore = sha256(FIXTURE);

  await check('the fixture is real Sprint 5 data: only legacy records (trigger + sceneId, no when/then)', () => {
    assert.ok(fixtureRecords.length >= 1);
    for (const r of fixtureRecords) {
      assert.ok(r.trigger && r.sceneId);
      assert.strictEqual(r.when, undefined);
      assert.strictEqual(r.then, undefined);
    }
  });

  await check('list / get return exactly the stored Sprint 5 records', async () => {
    const t = setup();
    try {
      assert.deepStrictEqual(await t.service.listAutomations(), fixtureRecords);
      assert.deepStrictEqual(await t.service.listAutomations({ includeRules: true }), fixtureRecords);
      assert.deepStrictEqual(await t.service.getAutomation(fixtureRecords[0].id), fixtureRecords[0]);
    } finally {
      cleanup(t.dir);
    }
  });

  await check('read-only operations and scheduler ticks leave the data file byte-identical (SHA-256)', async () => {
    const t = setup();
    try {
      const before = sha256(t.file);
      assert.strictEqual(before, fixtureHashBefore);
      await t.service.listAutomations();
      await t.service.listAutomations({ includeRules: true });
      await t.service.getAutomation(fixtureRecords[0].id);
      await t.scheduler(new Date(2026, 8, 21, 16, 55, 0)).tick();
      await t.scheduler(new Date(2026, 8, 21, 3, 0, 0)).tick();
      assert.strictEqual(sha256(t.file), before);
    } finally {
      cleanup(t.dir);
    }
  });

  await check('the scheduler still runs the Sprint 5 automation at its time (16:55) and not at other times', async () => {
    const t = setup();
    try {
      await t.scheduler(new Date(2026, 8, 21, 16, 54, 0)).tick();
      assert.deepStrictEqual(t.executed, []);
      await t.scheduler(new Date(2026, 8, 21, 16, 55, 0)).tick();
      assert.deepStrictEqual(t.executed, [SCENE_ID]);
      // the second record (18:00) is disabled in the fixture: it never runs
      await t.scheduler(new Date(2026, 8, 21, 18, 0, 0)).tick();
      assert.deepStrictEqual(t.executed, [SCENE_ID]);
    } finally {
      cleanup(t.dir);
    }
  });

  await check('after creating a rule, the Sprint 5 records are still in the file, unchanged (deepStrictEqual)', async () => {
    const t = setup();
    try {
      const rule = await t.service.createAutomation({
        name: 'New rule',
        enabled: true,
        when: { type: 'time', at: '07:00' },
        then: [{ type: 'scene', sceneId: SCENE_ID }],
      });
      const onDisk = JSON.parse(fs.readFileSync(t.file, 'utf8'));
      assert.strictEqual(onDisk.length, fixtureRecords.length + 1);
      assert.deepStrictEqual(onDisk.slice(0, fixtureRecords.length), fixtureRecords);
      assert.deepStrictEqual(onDisk[onDisk.length - 1], rule);
      // the default list (what Sprint 5 clients call) still shows only the Sprint 5 records
      assert.deepStrictEqual(await t.service.listAutomations(), fixtureRecords);
      assert.ok((await t.service.listAutomations({ includeRules: true })).some((r) => r.id === rule.id));
    } finally {
      cleanup(t.dir);
    }
  });

  await check('a Sprint 5 style PUT (toggle enabled) still works exactly like Sprint 5 and only changes that record', async () => {
    const t = setup();
    try {
      const target = fixtureRecords[0];
      const updated = await t.service.updateAutomation(target.id, {
        name: target.name,
        enabled: false,
        trigger: target.trigger,
        sceneId: target.sceneId,
      });
      assert.strictEqual(updated.enabled, false);
      assert.strictEqual(updated.trigger.time, target.trigger.time);
      assert.strictEqual(updated.sceneId, target.sceneId);
      assert.strictEqual(updated.schemaVersion, undefined);
      assert.strictEqual(updated.when, undefined);
      const onDisk = JSON.parse(fs.readFileSync(t.file, 'utf8'));
      assert.deepStrictEqual(onDisk[1], fixtureRecords[1]); // untouched neighbour
      assert.deepStrictEqual(Object.keys(onDisk[0]).sort(), Object.keys(target).sort());
    } finally {
      cleanup(t.dir);
    }
  });

  await check('the committed fixture itself was never modified by these tests', () => {
    assert.strictEqual(sha256(FIXTURE), fixtureHashBefore);
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
