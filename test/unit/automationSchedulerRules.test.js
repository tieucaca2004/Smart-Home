'use strict';

/**
 * Unit tests for AutomationScheduler with the Sprint 6 rule engine attached:
 * rules run when their condition turns true, legacy (Sprint 5) automations
 * keep running in the same tick, and without a ruleEngine rules are ignored.
 */

const assert = require('assert');
const AutomationScheduler = require('../../src/services/AutomationScheduler');
const RuleEngine = require('../../src/automation/RuleEngine');
const createDefaultRegistries = require('../../src/automation/createDefaultRegistries');

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

const silent = { log: () => {}, error: () => {}, warn: () => {} };
const AT_18_00 = new Date(2026, 0, 15, 18, 0, 0);

function fakeAutomationService(records) {
  const calls = [];
  return {
    calls,
    async listAutomations(options) {
      calls.push(options);
      return options && options.includeRules ? records : records.filter((r) => r.when === undefined && r.then === undefined);
    },
  };
}

const legacy = (o = {}) => ({
  id: 'legacy-1', name: 'Legacy', enabled: true, trigger: { type: 'daily', time: '18:00' }, sceneId: 'scene-legacy', ...o,
});
const ruleRecord = (o = {}) => ({
  id: 'rule-1',
  name: 'Rule',
  enabled: true,
  schemaVersion: 2,
  updatedAt: 'v1',
  when: { type: 'device_state', deviceId: 'sw', statusCode: 'on', equals: true },
  then: [{ type: 'command', deviceId: 'lamp', functionCode: 'switch_1', value: true }],
  ...o,
});

function world(sw = false) {
  const w = { devices: { sw: { on: sw }, lamp: { switch_1: false } }, commands: [], scenes: [] };
  w.deviceService = {
    async getDeviceStatus(id) { return Object.entries(w.devices[id]).map(([code, value]) => ({ code, value })); },
    async sendCommand(id, code, value) { w.commands.push([id, code, value]); w.devices[id][code] = value; return true; },
  };
  w.sceneService = {
    async getScene(id) { return { id }; },
    async executeScene(id) { w.scenes.push(id); return { success: true, sceneName: id, results: [] }; },
  };
  return w;
}

function build(records, w, extra = {}) {
  const registries = createDefaultRegistries({ deviceService: w.deviceService, sceneService: w.sceneService });
  const ruleEngine = new RuleEngine({ deviceService: w.deviceService, ...registries, log: silent });
  const automationService = fakeAutomationService(records);
  const scheduler = new AutomationScheduler(automationService, w.sceneService, {
    now: () => AT_18_00,
    log: silent,
    ruleEngine,
    ...extra,
  });
  return { scheduler, automationService, ruleEngine };
}

async function run() {
  console.log('=== AutomationScheduler + rules unit tests ===\n');

  await check('a rule runs when its condition turns true (edge), not while it stays true', async () => {
    const w = world(false);
    const { scheduler } = build([ruleRecord()], w);
    await scheduler.tick(); // observe false
    assert.deepStrictEqual(w.commands, []);
    w.devices.sw.on = true;
    await scheduler.tick();
    assert.deepStrictEqual(w.commands, [['lamp', 'switch_1', true]]);
    await scheduler.tick();
    await scheduler.tick();
    assert.strictEqual(w.commands.length, 1);
  });

  await check('the scheduler asks for ALL records (includeRules) so it can see rules', async () => {
    const w = world();
    const { scheduler, automationService } = build([ruleRecord()], w);
    await scheduler.tick();
    assert.deepStrictEqual(automationService.calls, [{ includeRules: true }]);
  });

  await check('legacy automations and rules both run in the same tick', async () => {
    const w = world(false);
    const { scheduler } = build([legacy(), ruleRecord()], w);
    await scheduler.tick(); // legacy fires at 18:00 immediately (Sprint 5 behaviour); rule only observes
    assert.deepStrictEqual(w.scenes, ['scene-legacy']);
    assert.deepStrictEqual(w.commands, []);
    w.devices.sw.on = true;
    await scheduler.tick();
    assert.deepStrictEqual(w.scenes, ['scene-legacy']); // legacy: once per minute, unchanged
    assert.deepStrictEqual(w.commands, [['lamp', 'switch_1', true]]);
  });

  await check('without a ruleEngine, rules are ignored and legacy automations still run', async () => {
    const w = world(true);
    const { scheduler } = build([legacy(), ruleRecord()], w, { ruleEngine: null });
    await scheduler.tick();
    await scheduler.tick();
    assert.deepStrictEqual(w.scenes, ['scene-legacy']);
    assert.deepStrictEqual(w.commands, []);
  });

  await check('disabled rules do not run; re-enabling counts as a fresh observation (no fire on re-enable)', async () => {
    const w = world(false);
    const records = [ruleRecord()];
    const { scheduler } = build(records, w);
    await scheduler.tick(); // observed false
    records[0] = ruleRecord({ enabled: false });
    w.devices.sw.on = true;
    await scheduler.tick(); // disabled: nothing, state dropped
    assert.deepStrictEqual(w.commands, []);
    records[0] = ruleRecord({ enabled: true });
    await scheduler.tick(); // enabled again while the condition is already true: first observation only
    assert.deepStrictEqual(w.commands, []);
  });

  await check('a rule that throws does not stop other rules or the legacy path, and does not throw out of tick()', async () => {
    const w = world(false);
    const errors = [];
    const { scheduler, ruleEngine } = build(
      [legacy(), ruleRecord({ id: 'bad', name: 'Bad' }), ruleRecord({ id: 'good', name: 'Good' })],
      w,
      { log: { log: () => {}, error: (m) => errors.push(m), warn: () => {} } }
    );
    const realNewTick = ruleEngine.newTick.bind(ruleEngine);
    ruleEngine.newTick = (now) => {
      const tick = realNewTick(now);
      const realRun = tick.runRule.bind(tick);
      tick.runRule = async (rule) => {
        if (rule.id === 'bad') throw new Error('boom');
        return realRun(rule);
      };
      return tick;
    };
    await scheduler.tick(); // must not throw
    assert.deepStrictEqual(w.scenes, ['scene-legacy']);
    assert.ok(errors.some((m) => m.includes('boom') && m.includes('Bad')));
    w.devices.sw.on = true;
    await scheduler.tick();
    assert.deepStrictEqual(w.commands, [['lamp', 'switch_1', true]]); // "good" still fires
  });

  await check('an unreadable sensor (unknown) does not fire and does not throw out of tick()', async () => {
    const w = world(false);
    w.deviceService.getDeviceStatus = async () => { throw new Error('offline'); };
    const { scheduler } = build([ruleRecord()], w);
    await scheduler.tick();
    await scheduler.tick();
    assert.deepStrictEqual(w.commands, []);
  });

  await check('device reads are shared within a tick across rules', async () => {
    const w = world(false);
    let reads = 0;
    const realRead = w.deviceService.getDeviceStatus;
    w.deviceService.getDeviceStatus = async (id) => { reads += 1; return realRead(id); };
    const { scheduler } = build([ruleRecord({ id: 'r1' }), ruleRecord({ id: 'r2' }), ruleRecord({ id: 'r3' })], w);
    await scheduler.tick();
    assert.strictEqual(reads, 1);
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
