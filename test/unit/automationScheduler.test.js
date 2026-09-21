'use strict';

/**
 * Unit tests for AutomationScheduler.tick(): which automations fire, that a
 * matching automation only fires once per calendar minute even if tick() is
 * called again, and that one automation's scene blowing up never stops the
 * others or throws out of tick() itself.
 */

const assert = require('assert');
const AutomationScheduler = require('../../src/services/AutomationScheduler');

function silentLog() {
  return { log: () => {}, error: () => {} };
}

function fakeAutomationService(automations) {
  return { async listAutomations() { return automations; } };
}

function makeAutomation(overrides) {
  return {
    id: overrides.id || 'auto-1',
    name: overrides.name || 'Test automation',
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    trigger: overrides.trigger || { type: 'daily', time: '18:00' },
    sceneId: overrides.sceneId || 'scene-1',
  };
}

const AT_18_00 = new Date(2026, 0, 15, 18, 0, 0); // local time, day irrelevant

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
  console.log('=== AutomationScheduler unit tests ===\n');

  await check('tick() executes the scene of an enabled automation whose time matches now', async () => {
    const executed = [];
    const sceneService = { async executeScene(id) { executed.push(id); return { success: true, sceneName: 'S' }; } };
    const automationService = fakeAutomationService([makeAutomation({ sceneId: 'scene-42' })]);
    const scheduler = new AutomationScheduler(automationService, sceneService, {
      now: () => AT_18_00,
      log: silentLog(),
    });

    await scheduler.tick();

    assert.deepStrictEqual(executed, ['scene-42']);
  });

  await check('tick() skips a disabled automation', async () => {
    const executed = [];
    const sceneService = { async executeScene(id) { executed.push(id); return { success: true }; } };
    const automationService = fakeAutomationService([makeAutomation({ enabled: false })]);
    const scheduler = new AutomationScheduler(automationService, sceneService, {
      now: () => AT_18_00,
      log: silentLog(),
    });

    await scheduler.tick();

    assert.deepStrictEqual(executed, []);
  });

  await check('tick() skips an automation whose trigger time does not match now', async () => {
    const executed = [];
    const sceneService = { async executeScene(id) { executed.push(id); return { success: true }; } };
    const automationService = fakeAutomationService([
      makeAutomation({ trigger: { type: 'daily', time: '07:30' } }),
    ]);
    const scheduler = new AutomationScheduler(automationService, sceneService, {
      now: () => AT_18_00,
      log: silentLog(),
    });

    await scheduler.tick();

    assert.deepStrictEqual(executed, []);
  });

  await check('tick() does not run the same automation twice in the same minute', async () => {
    const executed = [];
    const sceneService = { async executeScene(id) { executed.push(id); return { success: true }; } };
    const automationService = fakeAutomationService([makeAutomation({ sceneId: 'scene-42' })]);
    const scheduler = new AutomationScheduler(automationService, sceneService, {
      now: () => AT_18_00,
      log: silentLog(),
    });

    await scheduler.tick();
    await scheduler.tick(); // same fixed "now" -> same minute

    assert.deepStrictEqual(executed, ['scene-42']);
  });

  await check('tick() runs the automation again once the minute has moved on', async () => {
    const executed = [];
    const sceneService = { async executeScene(id) { executed.push(id); return { success: true }; } };
    const automationService = fakeAutomationService([makeAutomation({ sceneId: 'scene-42' })]);
    let now = AT_18_00;
    const scheduler = new AutomationScheduler(automationService, sceneService, {
      now: () => now,
      log: silentLog(),
    });

    await scheduler.tick();
    now = new Date(2026, 0, 16, 18, 0, 0); // next day, same time-of-day
    await scheduler.tick();

    assert.deepStrictEqual(executed, ['scene-42', 'scene-42']);
  });

  await check('one automation whose scene throws does not stop the others in the same tick', async () => {
    const executed = [];
    const sceneService = {
      async executeScene(id) {
        if (id === 'broken-scene') throw new Error('boom');
        executed.push(id);
        return { success: true };
      },
    };
    const automationService = fakeAutomationService([
      makeAutomation({ id: 'a1', sceneId: 'broken-scene' }),
      makeAutomation({ id: 'a2', sceneId: 'scene-ok' }),
    ]);
    const scheduler = new AutomationScheduler(automationService, sceneService, {
      now: () => AT_18_00,
      log: silentLog(),
    });

    await scheduler.tick(); // must not throw

    assert.deepStrictEqual(executed, ['scene-ok']);
  });

  await check('a tick already in flight is not overlapped by a concurrent tick()', async () => {
    const executed = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const sceneService = {
      async executeScene(id) {
        await gate;
        executed.push(id);
        return { success: true };
      },
    };
    const automationService = fakeAutomationService([makeAutomation({ sceneId: 'scene-42' })]);
    const scheduler = new AutomationScheduler(automationService, sceneService, {
      now: () => AT_18_00,
      log: silentLog(),
    });

    const first = scheduler.tick();
    const second = scheduler.tick(); // should return immediately, doing nothing
    release();
    await Promise.all([first, second]);

    assert.deepStrictEqual(executed, ['scene-42']);
  });

  await check('listAutomations() failing is logged and does not throw out of tick()', async () => {
    const sceneService = { async executeScene() { return { success: true }; } };
    const automationService = { async listAutomations() { throw new Error('store unavailable'); } };
    const scheduler = new AutomationScheduler(automationService, sceneService, {
      now: () => AT_18_00,
      log: silentLog(),
    });

    await scheduler.tick(); // must not throw
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
