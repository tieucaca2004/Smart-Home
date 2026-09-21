'use strict';

/**
 * Unit tests for the `command` and `scene` actions (through ActionRegistry,
 * which is what the engine uses) using fake services - no network, no adapter.
 */

const assert = require('assert');
const createDefaultRegistries = require('../../src/automation/createDefaultRegistries');
const SceneService = require('../../src/services/sceneService'); // real class, only imported (contract test)
const { resolveVerify } = require('../../src/automation/readBack');

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

/** Fake device service: an in-memory device table with switchable failure modes. */
function fakeDeviceService(overrides = {}) {
  const state = { d1: { switch_1: false }, d2: { switch_1: false }, d3: { switch_1: false } };
  const calls = [];
  const reads = [];
  const pendingWrites = {}; // deviceId -> { code, value, staleReads } for devices that "lag"
  return {
    calls,
    reads,
    state,
    async sendCommand(deviceId, code, value) {
      calls.push([deviceId, code, value]);
      if (overrides.sendFails && overrides.sendFails.includes(deviceId)) {
        const err = new Error('device is offline');
        err.appCode = 'DEVICE_OFFLINE';
        throw err;
      }
      if (!state[deviceId]) {
        const err = new Error('no such device');
        err.appCode = 'DEVICE_NOT_FOUND';
        throw err;
      }
      if (overrides.lag && overrides.lag[deviceId] !== undefined) {
        // accepted now, visible to reads only after `lag[deviceId]` stale reads (propagation delay)
        pendingWrites[deviceId] = { code, value, staleReads: overrides.lag[deviceId] };
      } else if (!(overrides.ignoreCommand && overrides.ignoreCommand.includes(deviceId))) {
        state[deviceId][code] = value;
      }
      return true;
    },
    async getDeviceStatus(deviceId) {
      reads.push(deviceId);
      if (overrides.readFailsOnce && overrides.readFailsOnce.includes(deviceId) && reads.filter((d) => d === deviceId).length === 1) {
        throw new Error('read timeout');
      }
      if (overrides.readFails && overrides.readFails.includes(deviceId)) throw new Error('read timeout');
      const pw = pendingWrites[deviceId];
      if (pw) {
        if (pw.staleReads > 0) {
          pw.staleReads -= 1;
        } else {
          state[deviceId][pw.code] = pw.value;
          delete pendingWrites[deviceId];
        }
      }
      return Object.entries(state[deviceId] || {}).map(([code, value]) => ({ code, value }));
    },
  };
}

const cmd = (deviceId, value = true) => ({ type: 'command', deviceId, functionCode: 'switch_1', value });

/** Fake sleep that records the requested delays and never really waits. */
function fakeSleep() {
  const delays = [];
  return { delays, sleep: async (ms) => { delays.push(ms); } };
}

/** An action ctx like the one RuleEngine passes (fake sleep, optional budget). */
function vctx(sl, { retryDelayMs = 2000, budgetMs } = {}) {
  const verify = { retryDelayMs, sleep: sl.sleep };
  if (budgetMs !== undefined) verify.budget = { remainingMs: budgetMs };
  return { verify };
}

async function run() {
  console.log('=== actions unit tests ===\n');

  await check('command: success only after the read-back shows the requested value', async () => {
    const deviceService = fakeDeviceService();
    const { actionRegistry } = createDefaultRegistries({ deviceService });
    const sl = fakeSleep();
    const result = await actionRegistry.execute(cmd('d1', true), vctx(sl));
    // `status` is the new (additive) field of the result shape
    assert.deepStrictEqual(result, { type: 'command', deviceId: 'd1', functionCode: 'switch_1', value: true, success: true, status: 'success' });
    assert.deepStrictEqual(deviceService.calls, [['d1', 'switch_1', true]]);
    assert.deepStrictEqual(sl.delays, []); // confirmed at once: no waiting
    assert.strictEqual(deviceService.reads.length, 1);
  });

  await check('command: a rejected command is reported (not thrown) with the standard code', async () => {
    const { actionRegistry } = createDefaultRegistries({ deviceService: fakeDeviceService({ sendFails: ['d1'] }) });
    const result = await actionRegistry.execute(cmd('d1'), {});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.code, 'DEVICE_OFFLINE');
    assert.strictEqual(result.error, 'device is offline');
  });

  await check('command: accepted but never confirmed by the read-back -> UNCONFIRMED, now status "pending" (not failed)', async () => {
    const { actionRegistry } = createDefaultRegistries({ deviceService: fakeDeviceService({ ignoreCommand: ['d1'] }) });
    const result = await actionRegistry.execute(cmd('d1', true), vctx(fakeSleep()));
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'pending');
    assert.strictEqual(result.code, 'UNCONFIRMED');
  });

  await check('command: read-back itself failing every time -> pending/UNCONFIRMED (not success, not thrown)', async () => {
    const { actionRegistry } = createDefaultRegistries({ deviceService: fakeDeviceService({ readFails: ['d1'] }) });
    const result = await actionRegistry.execute(cmd('d1'), vctx(fakeSleep()));
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'pending');
    assert.strictEqual(result.code, 'UNCONFIRMED');
    assert.ok(result.error.includes('read timeout'));
  });

  await check('command: unknown device / device error never escapes execute()', async () => {
    const { actionRegistry } = createDefaultRegistries({ deviceService: fakeDeviceService() });
    const result = await actionRegistry.execute(cmd('ghost'), {});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'DEVICE_NOT_FOUND');
  });

  await check('command: value false is sent and confirmed as false (not treated as "no value")', async () => {
    const deviceService = fakeDeviceService();
    deviceService.state.d1.switch_1 = true;
    const { actionRegistry } = createDefaultRegistries({ deviceService });
    const result = await actionRegistry.execute(cmd('d1', false), {});
    assert.strictEqual(result.success, true);
    assert.strictEqual(deviceService.state.d1.switch_1, false);
  });

  await check('multiple commands: run in order; one failure does not stop the rest', async () => {
    const deviceService = fakeDeviceService({ sendFails: ['d2'] });
    const { actionRegistry } = createDefaultRegistries({ deviceService });
    const results = [];
    for (const action of [cmd('d1'), cmd('d2'), cmd('d3')]) {
      results.push(await actionRegistry.execute(action, {}));
    }
    assert.deepStrictEqual(results.map((r) => r.success), [true, false, true]);
    assert.deepStrictEqual(deviceService.calls.map((c) => c[0]), ['d1', 'd2', 'd3']);
  });

  // --- Bug 1: delayed, bounded read-back (SUCCESS / PENDING / FAILED) ---
  await check('command: delayed read-back succeeds on the second read -> success (confirmed after retry), one send, one delay', async () => {
    const deviceService = fakeDeviceService({ lag: { d1: 1 } }); // read #1 stale, read #2 fresh
    const { actionRegistry } = createDefaultRegistries({ deviceService });
    const sl = fakeSleep();
    const result = await actionRegistry.execute(cmd('d1', true), vctx(sl));
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.verifiedAfterRetry, true);
    assert.deepStrictEqual(sl.delays, [2000]);
    assert.strictEqual(deviceService.calls.length, 1); // never re-sent
    assert.strictEqual(deviceService.reads.length, 2);
  });

  await check('command: still unconfirmed after the retry -> PENDING (never failed); exactly 2 reads, command not re-sent', async () => {
    const deviceService = fakeDeviceService({ lag: { d1: 5 } });
    const { actionRegistry } = createDefaultRegistries({ deviceService });
    const sl = fakeSleep();
    const result = await actionRegistry.execute(cmd('d1', true), vctx(sl));
    assert.strictEqual(result.status, 'pending');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'UNCONFIRMED');
    assert.ok(!/fail/i.test(result.error), result.error);
    assert.strictEqual(deviceService.reads.length, 2);
    assert.strictEqual(deviceService.calls.length, 1); // no double-fire
    assert.deepStrictEqual(sl.delays, [2000]);
  });

  await check('command: a genuine failure stays FAILED: no waiting, no read-back', async () => {
    const deviceService = fakeDeviceService({ sendFails: ['d1'] });
    const { actionRegistry } = createDefaultRegistries({ deviceService });
    const sl = fakeSleep();
    const result = await actionRegistry.execute(cmd('d1'), vctx(sl));
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.code, 'DEVICE_OFFLINE');
    assert.deepStrictEqual(sl.delays, []);
    assert.strictEqual(deviceService.reads.length, 0);
  });

  await check('command: first read throws, the re-read succeeds -> success; both reads throw -> pending with the read error', async () => {
    const flaky = fakeDeviceService({ readFailsOnce: ['d1'] });
    const sl = fakeSleep();
    const ok = await createDefaultRegistries({ deviceService: flaky }).actionRegistry.execute(cmd('d1'), vctx(sl));
    assert.strictEqual(ok.status, 'success');
    assert.strictEqual(ok.verifiedAfterRetry, true);
    assert.strictEqual(flaky.calls.length, 1);

    const dead = fakeDeviceService({ readFails: ['d1'] });
    const sl2 = fakeSleep();
    const pending = await createDefaultRegistries({ deviceService: dead }).actionRegistry.execute(cmd('d1'), vctx(sl2));
    assert.strictEqual(pending.status, 'pending');
    assert.ok(pending.error.includes('read timeout'));
    assert.strictEqual(dead.calls.length, 1);
  });

  await check('command: bounded wait - an exhausted budget means no sleep and no re-read, PENDING at once', async () => {
    const deviceService = fakeDeviceService({ lag: { d1: 1 } });
    const { actionRegistry } = createDefaultRegistries({ deviceService });
    const sl = fakeSleep();
    const ctx = vctx(sl, { retryDelayMs: 2000, budgetMs: 1999 });
    const result = await actionRegistry.execute(cmd('d1'), ctx);
    assert.strictEqual(result.status, 'pending');
    assert.deepStrictEqual(sl.delays, []);
    assert.strictEqual(deviceService.reads.length, 1);
    assert.strictEqual(ctx.verify.budget.remainingMs, 1999); // untouched

    // a sufficient budget is spent by the wait
    const d2 = fakeDeviceService({ lag: { d1: 1 } });
    const ctx2 = vctx(fakeSleep(), { retryDelayMs: 2000, budgetMs: 2500 });
    const ok = await createDefaultRegistries({ deviceService: d2 }).actionRegistry.execute(cmd('d1'), ctx2);
    assert.strictEqual(ok.status, 'success');
    assert.strictEqual(ctx2.verify.budget.remainingMs, 500);
  });

  await check('verify options: retryDelayMs is clamped to 0..5000, wrong types fall back to the defaults', async () => {
    assert.strictEqual(resolveVerify({ verify: { retryDelayMs: 999999 } }).retryDelayMs, 5000);
    assert.strictEqual(resolveVerify({ verify: { retryDelayMs: -5 } }).retryDelayMs, 0);
    assert.strictEqual(resolveVerify({ verify: { retryDelayMs: '10' } }).retryDelayMs, 2000);
    assert.strictEqual(resolveVerify({ verify: { retryDelayMs: NaN } }).retryDelayMs, 2000);
    assert.strictEqual(resolveVerify({}).retryDelayMs, 2000);
    assert.strictEqual(resolveVerify(undefined).retryDelayMs, 2000);
    assert.strictEqual(typeof resolveVerify({ verify: { sleep: 'nope' } }).sleep, 'function');
    assert.strictEqual(resolveVerify({ verify: { budget: 'x' } }).budget, null);
    // 0 = do not wait, but still re-read once
    const deviceService = fakeDeviceService({ lag: { d1: 1 } });
    const sl = fakeSleep();
    const r = await createDefaultRegistries({ deviceService }).actionRegistry.execute(cmd('d1'), vctx(sl, { retryDelayMs: 0 }));
    assert.strictEqual(r.status, 'success');
    assert.deepStrictEqual(sl.delays, [0]);
  });

  await check('command validate: trims ids, requires a boolean value, rejects extras', async () => {
    const { actionRegistry } = createDefaultRegistries({ deviceService: {} });
    const ok = await actionRegistry.validateList([{ type: 'command', deviceId: ' d1 ', functionCode: 'switch_1', value: true }]);
    assert.deepStrictEqual(ok, [cmd('d1')]);
    for (const [bad, fragment] of [
      [{ type: 'command', deviceId: '', functionCode: 'c', value: true }, 'then[0].deviceId'],
      [{ type: 'command', deviceId: 'd', functionCode: 5, value: true }, 'then[0].functionCode'],
      [{ type: 'command', deviceId: 'd', functionCode: 'c', value: 'on' }, 'then[0].value must be a boolean'],
      [{ type: 'command', deviceId: 'd', functionCode: 'c', value: 1 }, 'then[0].value'],
      [{ type: 'command', deviceId: 'd', functionCode: 'c', value: true, delay: 5 }, 'then[0].delay'],
    ]) {
      await assert.rejects(
        actionRegistry.validateList([bad]),
        (err) => err.code === 'VALIDATION_ERROR' && err.message.includes(fragment),
        JSON.stringify(bad)
      );
    }
  });

  await check('validateList: empty, too long, non-array, unknown type -> VALIDATION_ERROR', async () => {
    const { actionRegistry } = createDefaultRegistries({ deviceService: {} });
    for (const bad of [[], undefined, 'x', Array.from({ length: 21 }, () => cmd('d1')), [{ type: 'email' }], ['x']]) {
      await assert.rejects(actionRegistry.validateList(bad), (err) => err.code === 'VALIDATION_ERROR');
    }
    await actionRegistry.validateList(Array.from({ length: 20 }, () => cmd('d1'))); // 20 is the max
  });

  // --- scene ---
  function fakeSceneService(existing = ['scene-1']) {
    const executed = [];
    return {
      executed,
      async getScene(id) {
        if (!existing.includes(id)) {
          const err = new Error(`Scene "${id}" not found`);
          err.code = 'SCENE_NOT_FOUND';
          throw err;
        }
        return { id };
      },
      async executeScene(id) {
        if (!existing.includes(id)) {
          const err = new Error(`Scene "${id}" not found`);
          err.code = 'SCENE_NOT_FOUND';
          throw err;
        }
        executed.push(id);
        return { sceneId: id, sceneName: 'Mở quán', success: true, results: [{ success: true }] };
      },
    };
  }

  await check('scene: validate requires the scene to exist (SCENE_NOT_FOUND passes through)', async () => {
    const { actionRegistry } = createDefaultRegistries({ sceneService: fakeSceneService() });
    assert.deepStrictEqual(await actionRegistry.validateList([{ type: 'scene', sceneId: 'scene-1' }]), [
      { type: 'scene', sceneId: 'scene-1' },
    ]);
    await assert.rejects(actionRegistry.validateList([{ type: 'scene', sceneId: 'nope' }]), (e) => e.code === 'SCENE_NOT_FOUND');
    await assert.rejects(actionRegistry.validateList([{ type: 'scene', sceneId: '' }]), (e) => e.code === 'VALIDATION_ERROR');
    await assert.rejects(
      actionRegistry.validateList([{ type: 'scene', sceneId: 'scene-1', extra: 1 }]),
      (e) => e.code === 'VALIDATION_ERROR' && e.message.includes('then[0].extra')
    );
  });

  await check('scene: execute runs exactly that scene and reports its outcome', async () => {
    const sceneService = fakeSceneService();
    const { actionRegistry } = createDefaultRegistries({ sceneService });
    const result = await actionRegistry.execute({ type: 'scene', sceneId: 'scene-1' }, {});
    assert.deepStrictEqual(sceneService.executed, ['scene-1']);
    assert.strictEqual(result.type, 'scene');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sceneName, 'Mở quán');
  });

  await check('scene: a scene deleted after the rule was saved -> failure reported, not thrown', async () => {
    const { actionRegistry } = createDefaultRegistries({ sceneService: fakeSceneService([]) });
    const result = await actionRegistry.execute({ type: 'scene', sceneId: 'gone' }, {});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'SCENE_NOT_FOUND');
  });

  await check('scene: a partially failing scene reports success:false', async () => {
    const sceneService = fakeSceneService();
    sceneService.executeScene = async () => ({ sceneName: 'S', success: false, results: [{ success: false }] });
    const { actionRegistry } = createDefaultRegistries({ sceneService });
    assert.strictEqual((await actionRegistry.execute({ type: 'scene', sceneId: 'scene-1' }, {})).success, false);
  });

  // --- Bug 1 + 2 on the scene action ---
  /** Scene service double whose scene returns the given per-action results. */
  function sceneReturning(results, { success } = {}) {
    let runs = 0;
    return {
      get runs() { return runs; },
      async getScene(id) { return { id }; },
      async executeScene(id) {
        runs += 1;
        return { sceneId: id, sceneName: 'S', success: success !== undefined ? success : results.every((r) => r.success), results };
      },
    };
  }
  const unconfirmed = (deviceId, value = true) => ({
    deviceId, functionCode: 'switch_1', value, success: false, code: 'UNCONFIRMED', error: 'Command sent, but the device did not confirm the new value',
  });
  const okStep = (deviceId, value = true) => ({ deviceId, functionCode: 'switch_1', value, success: true });
  const sceneNode = { type: 'scene', sceneId: 'scene-1' };

  await check('scene: UNCONFIRMED steps that the device confirms after ONE shared delay become success; one read per device; no re-send', async () => {
    // three unconfirmed steps over two devices (d1 twice, d2 once)
    const deviceService = fakeDeviceService();
    deviceService.state.d1.switch_1 = true; // the devices changed after the (stale) immediate read-back
    deviceService.state.d2.switch_1 = true;
    const sceneService = sceneReturning([unconfirmed('d1'), unconfirmed('d1'), unconfirmed('d2')]);
    const { actionRegistry } = createDefaultRegistries({ deviceService, sceneService });
    const sl = fakeSleep();
    const result = await actionRegistry.execute(sceneNode, vctx(sl));
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.verifiedAfterRetry, true);
    assert.strictEqual(result.code, undefined);
    assert.strictEqual(result.error, undefined);
    assert.ok(result.results.every((r) => r.status === 'success' && r.success === true && r.code === undefined));
    assert.strictEqual(sceneService.runs, 1); // the scene ran exactly once
    assert.strictEqual(deviceService.calls.length, 0); // nothing was re-sent
    assert.deepStrictEqual(sl.delays, [2000]); // ONE delay for all three
    assert.deepStrictEqual(deviceService.reads.slice().sort(), ['d1', 'd2']); // one read per distinct device
  });

  await check('scene: UNCONFIRMED still unmatched after the re-verify -> PENDING with code and error; a mix with success stays pending', async () => {
    const deviceService = fakeDeviceService(); // d1 stays false
    const sceneService = sceneReturning([okStep('d2'), unconfirmed('d1', true)]);
    const { actionRegistry } = createDefaultRegistries({ deviceService, sceneService });
    const result = await actionRegistry.execute(sceneNode, vctx(fakeSleep()));
    assert.strictEqual(result.status, 'pending');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'UNCONFIRMED');
    assert.ok(result.error && !/fail/i.test(result.error), result.error);
    assert.deepStrictEqual(result.results.map((r) => r.status), ['success', 'pending']);
    assert.strictEqual(deviceService.calls.length, 0);
  });

  await check('scene: a step failing with another code is FAILED (code + deviceId/functionCode in the error), also when mixed with pending', async () => {
    const offline = { deviceId: 'd3', functionCode: 'switch_1', value: true, success: false, code: 'DEVICE_OFFLINE', error: 'device is offline' };
    const deviceService = fakeDeviceService();
    const sceneService = sceneReturning([unconfirmed('d1'), offline]);
    const { actionRegistry } = createDefaultRegistries({ deviceService, sceneService });
    const result = await actionRegistry.execute(sceneNode, vctx(fakeSleep()));
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'DEVICE_OFFLINE');
    assert.ok(result.error.includes('d3/switch_1') && result.error.includes('DEVICE_OFFLINE'), result.error);
    assert.ok(!result.error.includes('undefined'));
    assert.deepStrictEqual(result.results.map((r) => r.status), ['pending', 'failed']);
  });

  await check('scene: success:false without usable results -> FAILED with code SCENE_FAILED and a reason (never empty)', async () => {
    for (const results of [undefined, [], null]) {
      const sceneService = {
        async getScene() { return {}; },
        async executeScene() { return { sceneName: 'S', success: false, results }; },
      };
      const { actionRegistry } = createDefaultRegistries({ deviceService: fakeDeviceService(), sceneService });
      const result = await actionRegistry.execute(sceneNode, vctx(fakeSleep()));
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(result.code, 'SCENE_FAILED');
      assert.strictEqual(result.error, 'scene reported failure without details');
    }
  });

  await check('scene: without a deviceService in the factory the UNCONFIRMED steps stay pending (no throw, no wait)', async () => {
    const sceneService = sceneReturning([unconfirmed('d1')]);
    const { actionRegistry } = createDefaultRegistries({ sceneService }); // no deviceService
    const sl = fakeSleep();
    const result = await actionRegistry.execute(sceneNode, vctx(sl));
    assert.strictEqual(result.status, 'pending');
    assert.strictEqual(result.code, 'UNCONFIRMED');
    assert.deepStrictEqual(sl.delays, []);
  });

  await check('scene: an exhausted wait budget skips the re-verify and reports PENDING immediately', async () => {
    const deviceService = fakeDeviceService();
    deviceService.state.d1.switch_1 = true;
    const sceneService = sceneReturning([unconfirmed('d1')]);
    const { actionRegistry } = createDefaultRegistries({ deviceService, sceneService });
    const sl = fakeSleep();
    const result = await actionRegistry.execute(sceneNode, vctx(sl, { retryDelayMs: 2000, budgetMs: 0 }));
    assert.strictEqual(result.status, 'pending');
    assert.deepStrictEqual(sl.delays, []);
    assert.strictEqual(deviceService.reads.length, 0);
  });

  await check('scene contract: the REAL SceneService reports a stale immediate read-back as code UNCONFIRMED (with deviceId/functionCode/value); the action then confirms it', async () => {
    const scene = { id: 'scene-1', name: 'Real', actions: [{ deviceId: 'd1', functionCode: 'switch_1', value: true }] };
    const store = { async find(id) { return id === scene.id ? scene : null; } }; // in-memory store double

    // the contract itself: what SceneService returns for a not-yet-visible change
    const probeDevice = fakeDeviceService({ lag: { d1: 1 } });
    const probe = await new SceneService(store, probeDevice).executeScene('scene-1');
    assert.strictEqual(probe.results[0].code, 'UNCONFIRMED');
    assert.strictEqual(probe.results[0].success, false);
    assert.strictEqual(probe.results[0].deviceId, 'd1');
    assert.strictEqual(probe.results[0].functionCode, 'switch_1');
    assert.strictEqual(probe.results[0].value, true);

    // through the action: read #1 (SceneService) stale, read #2 (re-verify) fresh
    const deviceService = fakeDeviceService({ lag: { d1: 1 } });
    const { actionRegistry } = createDefaultRegistries({ deviceService, sceneService: new SceneService(store, deviceService) });
    const sl = fakeSleep();
    const result = await actionRegistry.execute(sceneNode, vctx(sl));
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.success, true);
    assert.strictEqual(deviceService.calls.length, 1); // the scene sent it once; the action never re-sent
    assert.deepStrictEqual(sl.delays, [2000]);
  });

  await check('registry: a custom executor returning {success:false} gets status "failed" + code + error; status is derived otherwise', async () => {
    const ActionRegistry = require('../../src/automation/ActionRegistry');
    const registry = new ActionRegistry()
      .register({ type: 'a', validate: (n) => n, execute: async () => ({ success: false }) })
      .register({ type: 'b', validate: (n) => n, execute: async () => ({ success: true }) })
      .register({ type: 'c', validate: (n) => n, execute: async () => ({ status: 'pending', success: false }) })
      .register({ type: 'd', validate: (n) => n, execute: async () => null });
    const a = await registry.execute({ type: 'a' }, {});
    assert.deepStrictEqual([a.status, a.code, a.error], ['failed', 'ACTION_FAILED', 'action reported failure without details']);
    assert.strictEqual((await registry.execute({ type: 'b' }, {})).status, 'success');
    const c = await registry.execute({ type: 'c' }, {});
    assert.deepStrictEqual([c.status, c.code], ['pending', 'UNCONFIRMED']);
    assert.strictEqual((await registry.execute({ type: 'd' }, {})).status, 'failed');
    assert.strictEqual((await registry.execute({ type: 'zzz' }, {})).status, 'failed');
  });

  await check('unknown action type at execute time -> UNSUPPORTED_ACTION, not thrown', async () => {
    const { actionRegistry } = createDefaultRegistries({});
    const result = await actionRegistry.execute({ type: 'email' }, {});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'UNSUPPORTED_ACTION');
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
