'use strict';

/**
 * Unit tests for withDeviceTimeout() (Round A / F-01): a hung device call is
 * abandoned with a recognizable DEVICE_TIMEOUT error instead of blocking its
 * caller forever, so the AutomationScheduler releases `_running` and later
 * automations still run. Fakes only: fake adapters, in-memory stores, no
 * network, no real credentials, no real devices. Timeouts are 20-50 ms.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceService = require('../../src/services/deviceService');
const SceneService = require('../../src/services/sceneService');
const JsonFileStore = require('../../src/storage/JsonFileStore');
const AutomationScheduler = require('../../src/services/AutomationScheduler');
const RuleEngine = require('../../src/automation/RuleEngine');
const createDefaultRegistries = require('../../src/automation/createDefaultRegistries');
const {
  withDeviceTimeout,
  readDeviceTimeoutOptions,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LIST_TIMEOUT_MS,
} = require('../../src/adapters/withDeviceTimeout');

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const never = () => new Promise(() => {});

function recordingLog() {
  const lines = { log: [], warn: [], error: [] };
  return {
    lines,
    log: (m) => lines.log.push(String(m)),
    warn: (m) => lines.warn.push(String(m)),
    error: (m) => lines.error.push(String(m)),
  };
}

/** Rejection value of a promise (fails the test if it resolves). */
async function rejectionOf(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the promise to reject');
}

function timeoutCount() {
  return process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
}

/**
 * Fake adapter (protocol "fake"). nativeId 'hung' never settles; 'half' accepts
 * commands but its status read never settles; anything else answers at once.
 */
function makeFakeAdapter() {
  const state = { sendCalls: [], statusCalls: [], sw: {} };
  const adapter = {
    state,
    get protocol() {
      return 'fake';
    },
    async getDevices() {
      return [{ id: 'fake:ok', nativeId: 'ok', protocol: 'fake', name: 'Ok', online: true }];
    },
    async getDeviceStatus(nativeId) {
      state.statusCalls.push(nativeId);
      if (nativeId === 'hung' || nativeId === 'half') return never();
      return [{ code: 'sw', value: state.sw[nativeId] === true }];
    },
    async getDeviceCapabilities(nativeId) {
      if (nativeId === 'hung') return never();
      return { commands: [], status: [] };
    },
    async sendCommand(nativeId, code, value) {
      state.sendCalls.push([nativeId, code, value]);
      if (nativeId === 'hung') return never();
      state.sw[nativeId] = value;
      return true;
    },
  };
  return adapter;
}

function buildServices(adapter, { withTimeout, timeoutMs = 40, log = silent } = {}) {
  const registry = new AdapterRegistry();
  registry.register(withTimeout === false ? adapter : withDeviceTimeout(adapter, { timeoutMs, log }));
  const deviceService = new DeviceService(registry);
  const sceneService = new SceneService(new JsonFileStore(), deviceService);
  return { registry, deviceService, sceneService };
}

const AT_18_00 = new Date(2026, 0, 15, 18, 0, 0);
const AT_18_01 = new Date(2026, 0, 15, 18, 1, 0);

async function addScene(sceneService, id, deviceId) {
  await sceneService.store.insert({
    id,
    name: `Scene ${id}`,
    icon: 'custom',
    actions: [{ deviceId, functionCode: 'sw', value: true }],
  });
}

const dailyAutomation = (id, sceneId, time = '18:00') => ({
  id,
  name: `Automation ${id}`,
  enabled: true,
  trigger: { type: 'daily', time },
  sceneId,
});

function fakeAutomationService(records) {
  return { async listAutomations() { return records; } };
}

/** Resolves 'settled' if `promise` settles within `ms`, else 'pending'. The race timer is always cleared. */
async function settlesWithin(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('pending'), ms);
  });
  try {
    return await Promise.race([promise.then(() => 'settled', () => 'settled'), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  console.log('=== withDeviceTimeout (F-01) unit tests ===\n');

  // ---------------------------------------------------------------- wrapper
  for (const [method, args, ms] of [
    ['getDeviceStatus', ['hung'], 30],
    ['sendCommand', ['hung', 'sw', true], 30],
    ['getDeviceCapabilities', ['hung'], 30],
  ]) {
    await check(`${method}: a hung call rejects with DEVICE_TIMEOUT within the configured time`, async () => {
      const wrapped = withDeviceTimeout(makeFakeAdapter(), { timeoutMs: ms, listTimeoutMs: 5000, log: silent });
      const started = Date.now();
      const err = await rejectionOf(wrapped[method](...args));
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= ms * 0.8, `rejected too early (${elapsed} ms)`);
      assert.ok(elapsed < 1000, `rejected too late (${elapsed} ms)`);
      assert.strictEqual(err.code, 'DEVICE_TIMEOUT');
      assert.strictEqual(err.appCode, 'DEVICE_TIMEOUT');
      assert.strictEqual(err.name, 'DeviceTimeoutError');
      assert.strictEqual(err.method, method);
      assert.match(err.message, /timed out/);
      assert.ok(!/undefined/.test(err.message));
      assert.ok(err.message.includes(method));
    });
  }

  await check('getDevices uses its own (list) timeout, separate from the per-call timeout', async () => {
    const adapter = makeFakeAdapter();
    adapter.getDevices = () => never();
    const wrapped = withDeviceTimeout(adapter, { timeoutMs: 20, listTimeoutMs: 120, log: silent });
    assert.strictEqual(wrapped.timeoutMs, 20);
    assert.strictEqual(wrapped.listTimeoutMs, 120);
    const started = Date.now();
    const err = await rejectionOf(wrapped.getDevices());
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 120 * 0.8, `used the short timeout instead of the list timeout (${elapsed} ms)`);
    assert.ok(elapsed < 1000);
    assert.strictEqual(err.code, 'DEVICE_TIMEOUT');
    assert.strictEqual(err.timeoutMs, 120);
  });

  await check('a timed-out sendCommand is called exactly once and never resent; message says so', async () => {
    const adapter = makeFakeAdapter();
    const wrapped = withDeviceTimeout(adapter, { timeoutMs: 25, log: silent });
    const err = await rejectionOf(wrapped.sendCommand('hung', 'sw', true));
    assert.match(err.message, /was not resent/);
    assert.match(err.message, /may still have been applied/);
    await sleep(25 * 3 + 20); // wait well past several deadlines
    assert.strictEqual(adapter.state.sendCalls.length, 1);
  });

  await check('logs exactly one [device-timeout] warning per timeout, with method and ms, no undefined/paths', async () => {
    const rec = recordingLog();
    const wrapped = withDeviceTimeout(makeFakeAdapter(), { timeoutMs: 25, log: rec });
    await rejectionOf(wrapped.getDeviceStatus('hung'));
    assert.strictEqual(rec.lines.warn.length, 1);
    const line = rec.lines.warn[0];
    assert.match(line, /\[device-timeout\]/);
    assert.match(line, /getDeviceStatus/);
    assert.match(line, /25 ms/);
    assert.ok(!/undefined/.test(line));
    assert.ok(!line.includes('hung'), 'must not include the device id');
    assert.ok(!/[\\/]/.test(line), 'must not look like a path');
    assert.strictEqual(rec.lines.log.length + rec.lines.error.length, 0);
  });

  await check('a successful call logs nothing', async () => {
    const rec = recordingLog();
    const wrapped = withDeviceTimeout(makeFakeAdapter(), { timeoutMs: 50, log: rec });
    await wrapped.getDeviceStatus('ok');
    await wrapped.sendCommand('ok', 'sw', true);
    assert.deepStrictEqual(rec.lines, { log: [], warn: [], error: [] });
  });

  // ------------------------------------------------------------ pass-through
  await check('pass-through: resolved value is returned as the very same object', async () => {
    const value = [{ code: 'sw', value: true }];
    const adapter = makeFakeAdapter();
    adapter.getDeviceStatus = async () => value;
    const wrapped = withDeviceTimeout(adapter, { timeoutMs: 50, log: silent });
    assert.strictEqual(await wrapped.getDeviceStatus('x'), value);
  });

  await check('pass-through: a non-timeout error is rethrown as the same object, without adding codes', async () => {
    const boom = new Error('boom');
    const adapter = makeFakeAdapter();
    adapter.sendCommand = async () => { throw boom; };
    const wrapped = withDeviceTimeout(adapter, { timeoutMs: 50, log: silent });
    const err = await rejectionOf(wrapped.sendCommand('x', 'sw', true));
    assert.strictEqual(err, boom);
    assert.strictEqual(err.code, undefined);
    assert.strictEqual(err.appCode, undefined);
  });

  await check('pass-through: arguments are forwarded unchanged and `this` is the wrapped adapter', async () => {
    const seen = [];
    const adapter = {
      protocol: 'fake',
      state: 'adapter-state',
      async getDevices() { seen.push(['getDevices', this.state]); return []; },
      async getDeviceStatus(...a) { seen.push(['getDeviceStatus', this.state, ...a]); return []; },
      async sendCommand(...a) { seen.push(['sendCommand', this.state, ...a]); return true; },
      async getDeviceCapabilities(...a) { seen.push(['getDeviceCapabilities', this.state, ...a]); return {}; },
    };
    const wrapped = withDeviceTimeout(adapter, { timeoutMs: 50, log: silent });
    await wrapped.getDevices();
    await wrapped.getDeviceStatus('n1');
    await wrapped.sendCommand('n2', 'sw', false);
    await wrapped.getDeviceCapabilities('n3');
    assert.deepStrictEqual(seen, [
      ['getDevices', 'adapter-state'],
      ['getDeviceStatus', 'adapter-state', 'n1'],
      ['sendCommand', 'adapter-state', 'n2', 'sw', false],
      ['getDeviceCapabilities', 'adapter-state', 'n3'],
    ]);
  });

  await check('pass-through: a synchronous throw becomes a rejection (same error object)', async () => {
    const boom = new Error('sync boom');
    const adapter = makeFakeAdapter();
    adapter.getDeviceStatus = () => { throw boom; };
    const wrapped = withDeviceTimeout(adapter, { timeoutMs: 50, log: silent });
    const pending = wrapped.getDeviceStatus('x'); // must not throw synchronously
    assert.strictEqual(await rejectionOf(pending), boom);
  });

  await check('a slow call that still finishes within the deadline succeeds', async () => {
    const adapter = makeFakeAdapter();
    adapter.getDeviceStatus = async () => { await sleep(20); return [{ code: 'sw', value: true }]; };
    const rec = recordingLog();
    const wrapped = withDeviceTimeout(adapter, { timeoutMs: 50, log: rec });
    assert.deepStrictEqual(await wrapped.getDeviceStatus('x'), [{ code: 'sw', value: true }]);
    assert.strictEqual(rec.lines.warn.length, 0);
  });

  await check('getDeviceCapabilities exists only when the wrapped adapter has it', async () => {
    const bare = { protocol: 'fake', async getDevices() { return []; }, async getDeviceStatus() { return []; }, async sendCommand() { return true; } };
    assert.strictEqual(typeof withDeviceTimeout(bare, { log: silent }).getDeviceCapabilities, 'undefined');
    assert.strictEqual(typeof withDeviceTimeout(makeFakeAdapter(), { log: silent }).getDeviceCapabilities, 'function');
  });

  await check('exposes `protocol`; AdapterRegistry.register + DeviceService work through the wrapper', async () => {
    const adapter = makeFakeAdapter();
    const { registry, deviceService } = buildServices(adapter, { timeoutMs: 50 });
    assert.strictEqual(registry.get('fake').protocol, 'fake');
    const { nativeId } = registry.resolve('fake:ok');
    assert.strictEqual(nativeId, 'ok');
    assert.deepStrictEqual(await deviceService.getDeviceStatus('fake:ok'), [{ code: 'sw', value: false }]);
    assert.strictEqual(await deviceService.sendCommand('fake:ok', 'sw', true), true);
    assert.deepStrictEqual(await deviceService.getDeviceCapabilities('fake:ok'), {
      id: 'fake:ok', protocol: 'fake', nativeId: 'ok', commands: [], status: [],
    });
    assert.strictEqual((await deviceService.listDevices()).length, 1);
    const err = await rejectionOf(deviceService.getDeviceStatus('fake:hung'));
    assert.strictEqual(err.appCode, 'DEVICE_TIMEOUT');
  });

  await check('option values that are not finite positive numbers fall back to the defaults', async () => {
    for (const bad of [0, -5, NaN, Infinity, 'abc', null, undefined]) {
      const wrapped = withDeviceTimeout(makeFakeAdapter(), { timeoutMs: bad, listTimeoutMs: bad, log: silent });
      assert.strictEqual(wrapped.timeoutMs, DEFAULT_TIMEOUT_MS);
      assert.strictEqual(wrapped.listTimeoutMs, DEFAULT_LIST_TIMEOUT_MS);
    }
  });

  // -------------------------------------------------------- timers and leaks
  await check('no Timeout resource is left behind after a successful call or after a timeout', async () => {
    await sleep(5);
    const before = timeoutCount();
    const wrapped = withDeviceTimeout(makeFakeAdapter(), { timeoutMs: 20, log: silent });
    await wrapped.getDeviceStatus('ok');
    assert.strictEqual(timeoutCount(), before, 'timer leaked after success');
    await rejectionOf(wrapped.getDeviceStatus('hung'));
    assert.strictEqual(timeoutCount(), before, 'timer leaked after timeout');
  });

  await check('a late rejection of the abandoned call causes no unhandledRejection', async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const adapter = makeFakeAdapter();
      adapter.getDeviceStatus = () => new Promise((_, reject) => setTimeout(() => reject(new Error('late failure')), 70));
      const wrapped = withDeviceTimeout(adapter, { timeoutMs: 20, log: silent });
      const err = await rejectionOf(wrapped.getDeviceStatus('x'));
      assert.strictEqual(err.code, 'DEVICE_TIMEOUT');
      await sleep(120); // the underlying promise rejects during this wait
      await sleep(0);
      assert.deepStrictEqual(unhandled, []);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  // ------------------------------------------------------------ env parsing
  await check('readDeviceTimeoutOptions: unset -> defaults (silently)', async () => {
    const rec = recordingLog();
    assert.deepStrictEqual(readDeviceTimeoutOptions({}, rec), { timeoutMs: 8000, listTimeoutMs: 30000 });
    assert.strictEqual(rec.lines.warn.length, 0);
  });

  await check('readDeviceTimeoutOptions: valid values are used', async () => {
    const rec = recordingLog();
    assert.deepStrictEqual(
      readDeviceTimeoutOptions({ HUB_DEVICE_TIMEOUT_MS: '5000', HUB_DEVICE_LIST_TIMEOUT_MS: ' 45000 ' }, rec),
      { timeoutMs: 5000, listTimeoutMs: 45000 }
    );
    assert.strictEqual(rec.lines.warn.length, 0);
  });

  await check('readDeviceTimeoutOptions: out-of-range values are clamped', async () => {
    assert.deepStrictEqual(
      readDeviceTimeoutOptions({ HUB_DEVICE_TIMEOUT_MS: '5', HUB_DEVICE_LIST_TIMEOUT_MS: '5' }, silent),
      { timeoutMs: 1000, listTimeoutMs: 1000 }
    );
    assert.deepStrictEqual(
      readDeviceTimeoutOptions({ HUB_DEVICE_TIMEOUT_MS: '999999', HUB_DEVICE_LIST_TIMEOUT_MS: '999999' }, silent),
      { timeoutMs: 60000, listTimeoutMs: 120000 }
    );
  });

  await check("readDeviceTimeoutOptions: 'abc' / '0' / '-5' fall back to defaults with a warning; '' silently", async () => {
    for (const bad of ['abc', '0', '-5']) {
      const rec = recordingLog();
      const opts = readDeviceTimeoutOptions({ HUB_DEVICE_TIMEOUT_MS: bad, HUB_DEVICE_LIST_TIMEOUT_MS: bad }, rec);
      assert.deepStrictEqual(opts, { timeoutMs: 8000, listTimeoutMs: 30000 });
      assert.strictEqual(rec.lines.warn.length, 2, `expected a warning per bad value for "${bad}"`);
      assert.ok(rec.lines.warn.every((l) => !/undefined/.test(l)));
    }
    const rec = recordingLog();
    assert.deepStrictEqual(
      readDeviceTimeoutOptions({ HUB_DEVICE_TIMEOUT_MS: '', HUB_DEVICE_LIST_TIMEOUT_MS: '  ' }, rec),
      { timeoutMs: 8000, listTimeoutMs: 30000 }
    );
    assert.strictEqual(rec.lines.warn.length, 0);
  });

  await check('the wrapper source is protocol-neutral (no vendor / protocol-specific strings)', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'adapters', 'withDeviceTimeout.js'), 'utf8');
    assert.ok(!/tuya|switch_/i.test(source));
  });

  // ------------------------------------------- scheduler recovery (REAL class)
  await check('NEGATIVE CONTROL: without the decorator a hung adapter leaves scheduler._running stuck at true', async () => {
    const adapter = makeFakeAdapter();
    const { sceneService } = buildServices(adapter, { withTimeout: false });
    await addScene(sceneService, 'sceneA', 'fake:hung');
    await addScene(sceneService, 'sceneB', 'fake:ok');
    await addScene(sceneService, 'sceneC', 'fake:ok');
    let now = AT_18_00;
    const records = [dailyAutomation('A', 'sceneA'), dailyAutomation('B', 'sceneB'), dailyAutomation('C', 'sceneC', '18:01')];
    const scheduler = new AutomationScheduler(fakeAutomationService(records), sceneService, { now: () => now, log: silent });

    assert.strictEqual(await settlesWithin(scheduler.tick(), 150), 'pending', 'tick() must NOT settle (bug reproduced)');
    assert.strictEqual(scheduler._running, true);
    assert.deepStrictEqual(adapter.state.sendCalls.map((c) => c[0]), ['hung']); // B never got to run

    now = AT_18_01;
    await scheduler.tick(); // returns at once: the guard sees _running
    assert.deepStrictEqual(adapter.state.sendCalls.map((c) => c[0]), ['hung']); // C never ran
  });

  await check('the REAL AutomationScheduler recovers from a hung device: _running released, later automations run', async () => {
    const adapter = makeFakeAdapter();
    const log = recordingLog();
    const { sceneService } = buildServices(adapter, { timeoutMs: 40, log });
    await addScene(sceneService, 'sceneA', 'fake:hung');
    await addScene(sceneService, 'sceneB', 'fake:ok');
    await addScene(sceneService, 'sceneC', 'fake:ok');

    // Spy (on the instance) to read the scene results the scheduler gets.
    const results = {};
    const realExecute = sceneService.executeScene.bind(sceneService);
    sceneService.executeScene = async (id) => {
      results[id] = await realExecute(id);
      return results[id];
    };

    let now = AT_18_00;
    const records = [dailyAutomation('A', 'sceneA'), dailyAutomation('B', 'sceneB'), dailyAutomation('C', 'sceneC', '18:01')];
    const scheduler = new AutomationScheduler(fakeAutomationService(records), sceneService, { now: () => now, log: silent });

    const started = Date.now();
    assert.strictEqual(await settlesWithin(scheduler.tick(), 1000), 'settled', 'tick() must settle');
    assert.ok(Date.now() - started < 1000);
    assert.strictEqual(scheduler._running, false);

    // The hung device was commanded exactly once (never resent), and classified.
    assert.strictEqual(adapter.state.sendCalls.filter((c) => c[0] === 'hung').length, 1);
    assert.strictEqual(results.sceneA.success, false);
    assert.strictEqual(results.sceneA.results[0].code, 'DEVICE_TIMEOUT');
    assert.ok(!/undefined/.test(JSON.stringify(results.sceneA)));
    assert.ok(log.lines.warn.some((l) => l.includes('[device-timeout]')));

    // Automation B (same minute, healthy device) still executed in the same tick.
    assert.strictEqual(results.sceneB.success, true);
    assert.deepStrictEqual(adapter.state.sendCalls.filter((c) => c[0] === 'ok'), [['ok', 'sw', true]]);

    // A later tick (next minute) runs a brand-new automation after the timeout.
    now = AT_18_01;
    await scheduler.tick();
    assert.strictEqual(scheduler._running, false);
    assert.strictEqual(results.sceneC.success, true);
    assert.strictEqual(adapter.state.sendCalls.filter((c) => c[0] === 'ok').length, 2);
    assert.strictEqual(adapter.state.sendCalls.filter((c) => c[0] === 'hung').length, 1);
  });

  // --------------------------------------------------- RuleEngine (v2) path
  const ruleRecord = (deviceId) => ({
    id: 'rule-1',
    name: 'Rule',
    enabled: true,
    schemaVersion: 2,
    updatedAt: 'v1',
    when: { type: 'device_state', deviceId: 'fake:sw', statusCode: 'sw', equals: true },
    then: [{ type: 'command', deviceId, functionCode: 'sw', value: true }],
  });

  function buildRuleWorld(adapter, records) {
    const engineLogs = recordingLog();
    const { deviceService, sceneService } = buildServices(adapter, { timeoutMs: 30, log: silent });
    const registries = createDefaultRegistries({ deviceService, sceneService });
    const ruleEngine = new RuleEngine({
      deviceService,
      ...registries,
      log: engineLogs,
      verify: { sleep: async () => {} },
    });
    return { engineLogs, ruleEngine, deviceService, sceneService, records };
  }

  await check('RuleEngine: a command on a hung device fails as `failed (DEVICE_TIMEOUT: ...)`, no undefined, scheduler recovers', async () => {
    const adapter = makeFakeAdapter();
    const w = buildRuleWorld(adapter);
    const scheduler = new AutomationScheduler(
      fakeAutomationService([ruleRecord('fake:hung')]),
      w.sceneService,
      { now: () => AT_18_00, log: silent, ruleEngine: w.ruleEngine }
    );

    await scheduler.tick(); // observes sw=false
    adapter.state.sw.sw = true;
    assert.strictEqual(await settlesWithin(scheduler.tick(), 1000), 'settled');
    assert.strictEqual(scheduler._running, false);

    const lines = w.engineLogs.lines.log;
    assert.ok(lines.some((l) => l.includes('failed (DEVICE_TIMEOUT:')), `log lines: ${JSON.stringify(lines)}`);
    for (const l of [...lines, ...w.engineLogs.lines.error, ...w.engineLogs.lines.warn]) {
      assert.ok(!/undefined/.test(l), `"undefined" in log line: ${l}`);
    }
    assert.strictEqual(adapter.state.sendCalls.filter((c) => c[0] === 'hung').length, 1);
    await sleep(100);
    assert.strictEqual(adapter.state.sendCalls.filter((c) => c[0] === 'hung').length, 1); // never resent
  });

  await check('RuleEngine: an accepted command whose read-back hangs is `pending` (UNCONFIRMED), not failed', async () => {
    const adapter = makeFakeAdapter();
    const w = buildRuleWorld(adapter);
    const rule = ruleRecord('fake:half');
    await w.ruleEngine.newTick(AT_18_00).runRule(rule); // observes sw=false
    adapter.state.sw.sw = true;
    const outcome = await w.ruleEngine.newTick(AT_18_00).runRule(rule);
    assert.strictEqual(outcome.fired, true);
    const action = outcome.actions[0];
    assert.strictEqual(action.status, 'pending');
    assert.strictEqual(action.code, 'UNCONFIRMED');
    assert.match(action.error, /status could not be read back yet: Device call timed out/);
    assert.ok(w.engineLogs.lines.log.some((l) => l.includes('pending')));
    assert.ok(!w.engineLogs.lines.log.some((l) => l.includes('failed (')));
    assert.ok(w.engineLogs.lines.log.every((l) => !/undefined/.test(l)));
    assert.strictEqual(adapter.state.sendCalls.filter((c) => c[0] === 'half').length, 1); // command not resent
  });

  // ----------------------------------------------------------- bootstrap wiring
  await check('bootstrap wires the timeout around the real registration (env override reaches the wrapper; no network)', async () => {
    const keys = ['TUYA_ACCESS_ID', 'TUYA_ACCESS_SECRET', 'TUYA_DISCOVERY', 'TUYA_DEVICE_IDS', 'HUB_DEVICE_TIMEOUT_MS', 'HUB_DEVICE_LIST_TIMEOUT_MS'];
    const saved = {};
    for (const k of keys) saved[k] = process.env[k];
    try {
      process.env.TUYA_ACCESS_ID = 'dummy_access_id';
      process.env.TUYA_ACCESS_SECRET = 'dummy_access_secret';
      process.env.TUYA_DISCOVERY = 'off';
      delete process.env.TUYA_DEVICE_IDS;
      process.env.HUB_DEVICE_TIMEOUT_MS = '1234';
      delete process.env.HUB_DEVICE_LIST_TIMEOUT_MS;
      const { buildDeviceService } = require('../../src/bootstrap');
      const service = buildDeviceService();
      const registered = service.registry.get('tuya');
      assert.strictEqual(registered.timeoutMs, 1234);
      assert.strictEqual(registered.listTimeoutMs, DEFAULT_LIST_TIMEOUT_MS);
      assert.strictEqual(registered.protocol, 'tuya');
      assert.strictEqual(typeof registered.getDeviceCapabilities, 'function');
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
