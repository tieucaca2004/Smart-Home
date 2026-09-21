'use strict';

/**
 * Unit tests for RuleEngine: edge-triggered firing, unknown handling, state
 * reset rules, per-tick read cache, error isolation, and the four business
 * examples from the Sprint 6 brief run as real rules against a fake device world.
 */

const assert = require('assert');
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

/** A fake home: devices keyed by id, each `{ code: value }`; counts reads and commands. */
function fakeWorld(devices, opts = {}) {
  const world = {
    devices,
    offline: new Set(opts.offline || []),
    reads: [],
    commands: [],
    scenes: opts.scenes || { 'scene-1': [['lamp', 'switch_1', true]] },
    sceneRuns: [],
    // deviceId -> number of stale status reads before a sent command becomes visible (propagation delay)
    lag: opts.lag || {},
    pendingWrites: {},
  };
  world.deviceService = {
    async getDeviceStatus(id) {
      world.reads.push(id);
      if (world.offline.has(id)) {
        const err = new Error('offline');
        err.appCode = 'DEVICE_OFFLINE';
        throw err;
      }
      if (!world.devices[id]) throw new Error('not found');
      const pw = world.pendingWrites[id];
      if (pw) {
        if (pw.staleReads > 0) {
          pw.staleReads -= 1;
        } else {
          world.devices[id][pw.code] = pw.value;
          delete world.pendingWrites[id];
        }
      }
      return Object.entries(world.devices[id]).map(([code, value]) => ({ code, value }));
    },
    async sendCommand(id, code, value) {
      world.commands.push([id, code, value]);
      if (!world.devices[id]) throw new Error('not found');
      if (world.lag[id] !== undefined) {
        world.pendingWrites[id] = { code, value, staleReads: world.lag[id] };
      } else {
        world.devices[id][code] = value;
      }
      return true;
    },
  };
  world.sceneService = {
    async getScene(id) {
      if (!world.scenes[id]) { const e = new Error('nf'); e.code = 'SCENE_NOT_FOUND'; throw e; }
      return { id };
    },
    async executeScene(id) {
      if (!world.scenes[id]) { const e = new Error(`Scene "${id}" not found`); e.code = 'SCENE_NOT_FOUND'; throw e; }
      world.sceneRuns.push(id);
      for (const [d, c, v] of world.scenes[id]) world.devices[d][c] = v;
      return { sceneId: id, sceneName: id, success: true, results: [] };
    },
  };
  return world;
}

/**
 * Builds an engine over the fake world. Delayed read-backs never really wait:
 * `sleeps` collects the delays the actions asked for (fake, injectable sleep).
 */
function makeEngine(world, extra = {}) {
  const logs = { log: [], error: [] };
  const sleeps = [];
  const log = { log: (m) => logs.log.push(m), error: (m) => logs.error.push(m), warn: () => {} };
  const registries = createDefaultRegistries({ deviceService: world.deviceService, sceneService: world.sceneService });
  const verify = { retryDelayMs: 2000, maxTotalWaitMs: 10000, sleep: async (ms) => { sleeps.push(ms); }, ...(extra.verify || {}) };
  const engine = new RuleEngine({ deviceService: world.deviceService, ...registries, log, ...extra, verify });
  return { engine, logs, sleeps };
}

/** Observes the door closed, then opens it and returns the outcome of the firing tick. */
async function fire(engine, world, r) {
  world.devices.door.contact = false;
  await engine.runRule(r, NOON);
  world.devices.door.contact = true;
  return engine.runRule(r, NOON);
}

let ruleSeq = 0;
function rule(overrides) {
  ruleSeq += 1;
  return {
    id: `rule-${ruleSeq}`,
    name: `Rule ${ruleSeq}`,
    enabled: true,
    schemaVersion: 2,
    updatedAt: '2026-09-21T00:00:00.000Z',
    when: { type: 'door', deviceId: 'door', statusCode: 'contact', equals: true },
    then: [{ type: 'command', deviceId: 'lamp', functionCode: 'switch_1', value: true }],
    ...overrides,
  };
}

const NOON = new Date(2026, 5, 15, 12, 0, 0);

async function run() {
  console.log('=== RuleEngine unit tests ===\n');

  await check('edge: fires once on false -> true, not while it stays true, and again after true -> false -> true', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({});

    assert.strictEqual((await engine.runRule(r, NOON)).fired, false); // first observation: door closed
    world.devices.door.contact = true;
    const fired = await engine.runRule(r, NOON);
    assert.strictEqual(fired.fired, true);
    assert.strictEqual(fired.actions[0].success, true);
    assert.deepStrictEqual(world.commands, [['lamp', 'switch_1', true]]);

    assert.strictEqual((await engine.runRule(r, NOON)).fired, false); // still open
    assert.strictEqual((await engine.runRule(r, NOON)).fired, false);
    assert.strictEqual(world.commands.length, 1);

    world.devices.door.contact = false;
    assert.strictEqual((await engine.runRule(r, NOON)).fired, false);
    world.devices.door.contact = true;
    assert.strictEqual((await engine.runRule(r, NOON)).fired, true);
    assert.strictEqual(world.commands.length, 2);
  });

  await check('first observation never fires, even if the condition is already true (e.g. Hub restart)', async () => {
    const world = fakeWorld({ door: { contact: true }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({});
    assert.strictEqual((await engine.runRule(r, NOON)).fired, false);
    assert.strictEqual((await engine.runRule(r, NOON)).fired, false); // still true, no edge
    assert.deepStrictEqual(world.commands, []);
    // a brand-new engine (= restarted Hub) also just observes
    const { engine: restarted } = makeEngine(world);
    assert.strictEqual((await restarted.runRule(r, NOON)).fired, false);
    assert.deepStrictEqual(world.commands, []);
  });

  await check('unknown never fires and keeps state: true -> unknown -> true does not re-fire', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({});
    await engine.runRule(r, NOON); // observed false
    world.devices.door.contact = true;
    assert.strictEqual((await engine.runRule(r, NOON)).fired, true);

    world.offline.add('door');
    const unknown = await engine.runRule(r, NOON);
    assert.strictEqual(unknown.result, null);
    assert.strictEqual(unknown.fired, false);
    world.offline.delete('door');
    assert.strictEqual((await engine.runRule(r, NOON)).fired, false); // still the same "true" episode
    assert.strictEqual(world.commands.length, 1);
  });

  await check('unknown between false and true still fires on the real edge (false -> unknown -> true)', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({});
    await engine.runRule(r, NOON);
    world.offline.add('door');
    await engine.runRule(r, NOON);
    world.offline.delete('door');
    world.devices.door.contact = true;
    assert.strictEqual((await engine.runRule(r, NOON)).fired, true);
  });

  await check('a first observation that is unknown fires nothing; the first known value is only recorded', async () => {
    const world = fakeWorld({ door: { contact: true }, lamp: { switch_1: false } }, { offline: ['door'] });
    const { engine } = makeEngine(world);
    const r = rule({});
    assert.strictEqual((await engine.runRule(r, NOON)).fired, false);
    world.offline.clear();
    assert.strictEqual((await engine.runRule(r, NOON)).fired, false); // first KNOWN observation: recorded only
    assert.deepStrictEqual(world.commands, []);
  });

  await check('unknown is logged once when it starts, not on every tick', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } }, { offline: ['door'] });
    const { engine, logs } = makeEngine(world);
    const r = rule({});
    for (let i = 0; i < 5; i += 1) await engine.runRule(r, NOON);
    assert.strictEqual(logs.log.filter((m) => m.includes('unknown')).length, 1);
    world.offline.clear();
    await engine.runRule(r, NOON); // known again
    world.offline.add('door');
    await engine.runRule(r, NOON); // unknown again -> logged again
    assert.strictEqual(logs.log.filter((m) => m.includes('unknown')).length, 2);
  });

  await check('editing a rule (updatedAt changes) resets its edge state; retain() forgets disabled/deleted rules', async () => {
    const world = fakeWorld({ door: { contact: true }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({});
    await engine.runRule(r, NOON); // observed true
    world.devices.door.contact = false;
    await engine.runRule(r, NOON); // observed false
    world.devices.door.contact = true;

    // edited -> new version -> counts as a first observation: no fire although false -> true happened
    const edited = { ...r, updatedAt: '2026-09-21T01:00:00.000Z' };
    assert.strictEqual((await engine.runRule(edited, NOON)).fired, false);
    world.devices.door.contact = false;
    await engine.runRule(edited, NOON);

    // disabled/deleted (not retained) -> state dropped -> re-enabling is a first observation
    engine.retain([]);
    world.devices.door.contact = true;
    assert.strictEqual((await engine.runRule(edited, NOON)).fired, false);
    assert.strictEqual(world.commands.length, 0);
  });

  await check('retain() keeps the state of rules that are still active', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({});
    await engine.runRule(r, NOON);
    engine.retain([r.id]);
    world.devices.door.contact = true;
    assert.strictEqual((await engine.runRule(r, NOON)).fired, true);
  });

  await check('within one tick a device is read at most once, however many rules use it', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const tick = engine.newTick(NOON);
    await tick.runRule(rule({ then: [{ type: 'command', deviceId: 'lamp', functionCode: 'switch_1', value: false }] }));
    await tick.runRule(rule({ then: [{ type: 'command', deviceId: 'lamp', functionCode: 'switch_1', value: false }] }));
    await tick.runRule(rule({ then: [{ type: 'command', deviceId: 'lamp', functionCode: 'switch_1', value: false }] }));
    assert.deepStrictEqual(world.reads, ['door']);
    await engine.newTick(NOON).runRule(rule({}));
    assert.deepStrictEqual(world.reads, ['door', 'door']); // a new tick reads again
  });

  await check('after actions ran, later rules in the same tick see fresh device state', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const opens = rule({ id: 'opens' });
    const lampOn = rule({
      id: 'lamp-watcher',
      when: { type: 'device_state', deviceId: 'lamp', statusCode: 'switch_1', equals: true },
      then: [{ type: 'command', deviceId: 'door', functionCode: 'contact', value: false }],
    });
    await engine.newTick(NOON).runRule(opens); // observe door closed
    await engine.newTick(NOON).runRule(lampOn); // observe lamp off
    world.devices.door.contact = true;

    const tick = engine.newTick(NOON);
    assert.strictEqual((await tick.runRule(opens)).fired, true); // turns the lamp on
    assert.strictEqual((await tick.runRule(lampOn)).fired, true); // must see lamp = on, not a stale "off"
  });

  await check('a failing action does not stop later actions of the same rule; results are reported per action', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false }, fan: { switch_1: false } });
    const { engine, logs } = makeEngine(world);
    const r = rule({
      then: [
        { type: 'command', deviceId: 'lamp', functionCode: 'switch_1', value: true },
        { type: 'command', deviceId: 'ghost', functionCode: 'switch_1', value: true },
        { type: 'command', deviceId: 'fan', functionCode: 'switch_1', value: true },
      ],
    });
    await engine.runRule(r, NOON);
    world.devices.door.contact = true;
    const outcome = await engine.runRule(r, NOON);
    assert.deepStrictEqual(outcome.actions.map((a) => a.success), [true, false, true]);
    assert.strictEqual(world.devices.fan.switch_1, true);
    assert.ok(logs.log.some((m) => m.includes('failed')));
  });

  await check('one rule blowing up does not affect other rules (evaluator exception -> unknown, others still fire)', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const broken = rule({ when: { type: 'no_such_type' } }); // stored rule with an unregistered type
    const good = rule({});
    const tick0 = engine.newTick(NOON);
    await tick0.runRule(broken);
    await tick0.runRule(good);
    world.devices.door.contact = true;
    const tick = engine.newTick(NOON);
    const brokenOutcome = await tick.runRule(broken);
    assert.strictEqual(brokenOutcome.fired, false);
    assert.strictEqual(brokenOutcome.result, null);
    assert.strictEqual((await tick.runRule(good)).fired, true);
  });

  await check('evaluateRule (dry run) returns the tree, runs no action and does not touch edge state', async () => {
    const world = fakeWorld({ door: { contact: true }, lamp: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({});
    const { result, tree } = await engine.evaluateRule(r, NOON);
    assert.strictEqual(result, true);
    assert.strictEqual(tree.type, 'door');
    assert.deepStrictEqual(world.commands, []);
    // dry runs did not record state: the first real observation still does not fire
    assert.strictEqual((await engine.runRule(r, NOON)).fired, false);
  });

  // ------------------------------------------------------------------ business examples
  await check('example 1: "if the door opens -> turn on lamp B" (fires once per opening)', async () => {
    const world = fakeWorld({ door: { doorcontact_state: false }, lampB: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({
      when: { type: 'door', deviceId: 'door', statusCode: 'doorcontact_state', equals: true },
      then: [{ type: 'command', deviceId: 'lampB', functionCode: 'switch_1', value: true }],
    });
    await engine.runRule(r, NOON);
    world.devices.door.doorcontact_state = true;
    await engine.runRule(r, NOON);
    await engine.runRule(r, NOON);
    assert.deepStrictEqual(world.commands, [['lampB', 'switch_1', true]]);
    assert.strictEqual(world.devices.lampB.switch_1, true);
  });

  await check('example 2: "in the afternoon -> close the curtain + turn on the balcony lamp"', async () => {
    const world = fakeWorld({ curtain: { control: false }, balcony: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({
      when: { type: 'time', from: '15:00', to: '18:00' },
      then: [
        { type: 'command', deviceId: 'curtain', functionCode: 'control', value: true },
        { type: 'command', deviceId: 'balcony', functionCode: 'switch_1', value: true },
      ],
    });
    assert.strictEqual((await engine.runRule(r, new Date(2026, 5, 15, 14, 59))).fired, false); // before the window
    assert.strictEqual((await engine.runRule(r, new Date(2026, 5, 15, 15, 0))).fired, true); // window opens: edge
    assert.strictEqual((await engine.runRule(r, new Date(2026, 5, 15, 15, 1))).fired, false);
    assert.deepStrictEqual(world.commands, [['curtain', 'control', true], ['balcony', 'switch_1', true]]);
    // next day: window closes at 18:00 then opens again -> fires again
    await engine.runRule(r, new Date(2026, 5, 15, 18, 0));
    assert.strictEqual((await engine.runRule(r, new Date(2026, 5, 16, 15, 0))).fired, true);
  });

  await check('example 3: "temperature > 35C around noon -> turn on the sprinkler" (AND, scaled sensor)', async () => {
    const world = fakeWorld({ sensor: { va_temperature: 300 }, sprinkler: { switch_1: false } });
    const { engine } = makeEngine(world);
    const r = rule({
      when: {
        type: 'and',
        conditions: [
          { type: 'time', from: '11:00', to: '14:00' },
          { type: 'temperature', deviceId: 'sensor', statusCode: 'va_temperature', operator: '>', value: 35, scale: 1 },
        ],
      },
      then: [{ type: 'command', deviceId: 'sprinkler', functionCode: 'switch_1', value: true }],
    });
    const noon = new Date(2026, 5, 15, 12, 0);
    assert.strictEqual((await engine.runRule(r, noon)).fired, false); // 30.0 C: observed false
    world.devices.sensor.va_temperature = 352; // 35.2 C
    assert.strictEqual((await engine.runRule(r, noon)).fired, true);
    assert.strictEqual((await engine.runRule(r, noon)).fired, false); // stays hot: no repeat
    assert.strictEqual(world.devices.sprinkler.switch_1, true);
    // outside the window the sensor is not even read
    world.reads.length = 0;
    await engine.runRule(r, new Date(2026, 5, 15, 16, 0));
    assert.deepStrictEqual(world.reads, []);
  });

  await check('example 4: nested AND/OR with several conditions and several actions incl. a scene', async () => {
    const world = fakeWorld(
      {
        door: { contact: false },
        pir: { presence: false },
        hum: { va_humidity: 40 },
        lamp: { switch_1: false },
        fan: { switch_1: false },
      },
      { scenes: { 'scene-1': [['lamp', 'switch_1', true]] } }
    );
    const { engine } = makeEngine(world);
    // (door open OR motion) AND humidity >= 60 AND (time 08:00-22:00)
    const r = rule({
      when: {
        type: 'and',
        conditions: [
          { type: 'time', from: '08:00', to: '22:00' },
          {
            type: 'or',
            conditions: [
              { type: 'door', deviceId: 'door', statusCode: 'contact', equals: true },
              { type: 'motion', deviceId: 'pir', statusCode: 'presence', equals: true },
            ],
          },
          { type: 'humidity', deviceId: 'hum', statusCode: 'va_humidity', operator: '>=', value: 60 },
        ],
      },
      then: [
        { type: 'scene', sceneId: 'scene-1' },
        { type: 'command', deviceId: 'fan', functionCode: 'switch_1', value: true },
      ],
    });
    await engine.runRule(r, NOON); // false
    world.devices.pir.presence = true;
    assert.strictEqual((await engine.runRule(r, NOON)).fired, false); // humidity still 40
    world.devices.hum.va_humidity = 65;
    const outcome = await engine.runRule(r, NOON);
    assert.strictEqual(outcome.fired, true);
    assert.deepStrictEqual(outcome.actions.map((a) => [a.type, a.success]), [['scene', true], ['command', true]]);
    assert.deepStrictEqual(world.sceneRuns, ['scene-1']);
    assert.strictEqual(world.devices.fan.switch_1, true);
  });

  await check('a scene action whose scene was deleted is reported as failed, other actions still run', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } }, { scenes: {} });
    const { engine } = makeEngine(world);
    const r = rule({
      then: [
        { type: 'scene', sceneId: 'gone' },
        { type: 'command', deviceId: 'lamp', functionCode: 'switch_1', value: true },
      ],
    });
    await engine.runRule(r, NOON);
    world.devices.door.contact = true;
    const outcome = await engine.runRule(r, NOON);
    assert.deepStrictEqual(outcome.actions.map((a) => a.success), [false, true]);
    assert.strictEqual(outcome.actions[0].code, 'SCENE_NOT_FOUND');
  });

  // ------------------------------------------------------------------ Bug 2: `failed (undefined)`
  const noBadWords = (lines) => lines.forEach((l) => assert.ok(!/undefined|null/.test(l), `log line must not contain undefined/null: ${l}`));

  await check('failed (undefined) fix: a failure without code/error always logs a real reason (registry, engine fallback, scene sub-result)', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });

    // (a) a custom executor that reports {success:false} only - normalised by the ActionRegistry
    const registries = createDefaultRegistries({ deviceService: world.deviceService, sceneService: world.sceneService });
    registries.actionRegistry.register({ type: 'flaky', validate: (n) => n, execute: async () => ({ success: false }) });
    const a = makeEngine(world, { actionRegistry: registries.actionRegistry });
    const outA = await fire(a.engine, world, rule({ then: [{ type: 'flaky' }] }));
    assert.strictEqual(outA.actions[0].status, 'failed');
    assert.ok(a.logs.log.some((l) => l.includes('failed (ACTION_FAILED: action reported failure without details)')), a.logs.log.join('\n'));
    noBadWords(a.logs.log);

    // (b) an action registry that bypasses the normalisation: the engine itself falls back
    const stub = (result) => ({ execute: async () => result, has: () => true, types: () => [] });
    const b = makeEngine(world, { actionRegistry: stub({ type: 'scene', sceneId: 's-1', success: false }) });
    await fire(b.engine, world, rule({ then: [{ type: 'scene', sceneId: 's-1' }] }));
    assert.ok(b.logs.log.some((l) => l.includes('failed (no reason reported)')), b.logs.log.join('\n'));
    noBadWords(b.logs.log);

    // (c) the engine digs the reason out of the scene's sub-results
    const c = makeEngine(world, {
      actionRegistry: stub({ type: 'scene', sceneId: 's-1', success: false, results: [{ deviceId: 'lamp', success: false, code: 'DEVICE_OFFLINE' }] }),
    });
    await fire(c.engine, world, rule({ then: [{ type: 'scene', sceneId: 's-1' }] }));
    assert.ok(c.logs.log.some((l) => l.includes('failed (DEVICE_OFFLINE)')), c.logs.log.join('\n'));
    noBadWords(c.logs.log);

    // (d) the real scene action with a failing step
    world.sceneService.executeScene = async (id) => ({
      sceneId: id,
      sceneName: id,
      success: false,
      results: [{ deviceId: 'lamp', functionCode: 'switch_1', value: true, success: false, code: 'DEVICE_OFFLINE', error: 'device is offline' }],
    });
    const d = makeEngine(world);
    const outD = await fire(d.engine, world, rule({ then: [{ type: 'scene', sceneId: 'scene-1' }] }));
    assert.strictEqual(outD.actions[0].status, 'failed');
    assert.ok(d.logs.log.some((l) => l.includes('failed (DEVICE_OFFLINE: 1 of 1 scene actions failed: lamp/switch_1: DEVICE_OFFLINE)')), d.logs.log.join('\n'));
    noBadWords(d.logs.log);
  });

  // ------------------------------------------------------------------ Bug 1: success / pending / failed
  await check('a delayed read-back is confirmed on the re-read: logged "success (confirmed after retry)", one command, one delay', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } }, { lag: { lamp: 1 } });
    const { engine, logs, sleeps } = makeEngine(world);
    const outcome = await fire(engine, world, rule({}));
    assert.strictEqual(outcome.actions[0].status, 'success');
    assert.strictEqual(outcome.status, 'success');
    assert.deepStrictEqual(outcome.summary, { success: 1, pending: 0, failed: 0 });
    assert.ok(logs.log.some((l) => l.includes('success (confirmed after retry)')), logs.log.join('\n'));
    assert.deepStrictEqual(world.commands, [['lamp', 'switch_1', true]]); // no double-fire
    assert.deepStrictEqual(sleeps, [2000]);
    assert.strictEqual(world.devices.lamp.switch_1, true);
  });

  await check('a state that stays unconfirmed is PENDING: normal log line, never "failed", never log.error; no double-fire', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } }, { lag: { lamp: 99 } });
    const { engine, logs } = makeEngine(world);
    const outcome = await fire(engine, world, rule({}));
    assert.strictEqual(outcome.actions[0].status, 'pending');
    assert.strictEqual(outcome.actions[0].code, 'UNCONFIRMED');
    assert.strictEqual(outcome.status, 'pending');
    assert.deepStrictEqual(outcome.summary, { success: 0, pending: 1, failed: 0 });
    const line = logs.log.find((l) => l.includes(' action command '));
    assert.ok(line && line.includes('pending'), line);
    assert.ok(!line.includes('failed'), line);
    assert.deepStrictEqual(logs.error, []);
    assert.strictEqual(world.commands.length, 1);
    noBadWords(logs.log);
  });

  await check('FAILED is only for real failures; a mixed rule [success, pending, failed] has summary {1,1,1} and status failed', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false }, fan: { switch_1: false } }, { lag: { fan: 99 } });
    const { engine, logs } = makeEngine(world);
    const outcome = await fire(
      engine,
      world,
      rule({
        then: [
          { type: 'command', deviceId: 'lamp', functionCode: 'switch_1', value: true },
          { type: 'command', deviceId: 'fan', functionCode: 'switch_1', value: true },
          { type: 'command', deviceId: 'ghost', functionCode: 'switch_1', value: true },
        ],
      })
    );
    assert.deepStrictEqual(outcome.actions.map((a) => a.status), ['success', 'pending', 'failed']);
    assert.deepStrictEqual(outcome.summary, { success: 1, pending: 1, failed: 1 });
    assert.strictEqual(outcome.status, 'failed');
    const actionLines = logs.log.filter((l) => l.includes(' action command '));
    assert.strictEqual(actionLines.length, 3);
    assert.ok(actionLines[0].endsWith('success'));
    assert.ok(actionLines[1].includes('pending') && !actionLines[1].includes('failed'));
    assert.ok(actionLines[2].includes('failed ('));
    assert.strictEqual(logs.error.length, 0); // the engine has always logged action results through log.log
  });

  await check('scene UNCONFIRMED steps: confirmed after the shared delay -> success; otherwise pending (not failed)', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });
    const unconfirmed = { deviceId: 'lamp', functionCode: 'switch_1', value: true, success: false, code: 'UNCONFIRMED', error: 'not confirmed' };
    world.sceneService.executeScene = async (id) => {
      world.sceneRuns.push(id);
      return { sceneId: id, sceneName: id, success: false, results: [unconfirmed] };
    };
    const r = rule({ then: [{ type: 'scene', sceneId: 'scene-1' }] });

    world.devices.lamp.switch_1 = true; // it did change; the scene's immediate read-back was stale
    const ok = makeEngine(world);
    const out1 = await fire(ok.engine, world, r);
    assert.strictEqual(out1.actions[0].status, 'success');
    assert.ok(ok.logs.log.some((l) => l.includes('success (confirmed after retry)')), ok.logs.log.join('\n'));
    assert.deepStrictEqual(world.sceneRuns, ['scene-1']); // the scene ran once
    assert.deepStrictEqual(world.commands, []); // and nothing was re-sent

    world.devices.lamp.switch_1 = false; // never becomes visible
    const late = makeEngine(world);
    const out2 = await fire(late.engine, world, rule({ then: [{ type: 'scene', sceneId: 'scene-1' }] }));
    assert.strictEqual(out2.actions[0].status, 'pending');
    assert.ok(late.logs.log.some((l) => l.includes('pending')) && !late.logs.log.some((l) => l.includes('failed')), late.logs.log.join('\n'));
    assert.strictEqual(late.logs.error.length, 0);
    noBadWords(late.logs.log);
  });

  await check('edge semantics are unchanged after a PENDING or FAILED action: no re-fire while the condition stays true', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } }, { lag: { lamp: 99 } });
    const { engine } = makeEngine(world);
    const r = rule({});
    const first = await fire(engine, world, r);
    assert.strictEqual(first.actions[0].status, 'pending');
    for (let i = 0; i < 3; i += 1) assert.strictEqual((await engine.runRule(r, NOON)).fired, false);
    assert.strictEqual(world.commands.length, 1);

    const failing = rule({ then: [{ type: 'command', deviceId: 'ghost', functionCode: 'switch_1', value: true }] });
    const second = await fire(engine, world, failing);
    assert.strictEqual(second.actions[0].status, 'failed');
    assert.strictEqual((await engine.runRule(failing, NOON)).fired, false);
    assert.strictEqual(world.commands.length, 2); // the one ghost attempt, no retry

    // a rule that did not fire carries no summary/status (additive keys only when fired)
    const idle = await engine.runRule(rule({}), NOON);
    assert.strictEqual(idle.fired, false);
    assert.ok(!('summary' in idle) && !('status' in idle));
  });

  await check('bounded wait per rule: total sleeping <= maxTotalWaitMs, later actions stop waiting, the budget resets on the next firing', async () => {
    const world = fakeWorld(
      { door: { contact: false }, lamp: { switch_1: false }, fan: { switch_1: false }, heater: { switch_1: false } },
      { lag: { lamp: 99, fan: 99, heater: 99 } }
    );
    const { engine, sleeps } = makeEngine(world, { verify: { retryDelayMs: 2000, maxTotalWaitMs: 3000 } });
    const r = rule({
      then: ['lamp', 'fan', 'heater'].map((deviceId) => ({ type: 'command', deviceId, functionCode: 'switch_1', value: true })),
    });
    const outcome = await fire(engine, world, r);
    assert.deepStrictEqual(outcome.actions.map((a) => a.status), ['pending', 'pending', 'pending']);
    assert.deepStrictEqual(sleeps, [2000]); // 2nd and 3rd found 1000 ms left (< 2000): no wait
    assert.ok(sleeps.reduce((a, b) => a + b, 0) <= 3000);
    assert.strictEqual(world.commands.length, 3);

    const outcome2 = await fire(engine, world, r); // next firing: a fresh budget
    assert.strictEqual(outcome2.fired, true);
    assert.deepStrictEqual(sleeps, [2000, 2000]);
  });

  await check('verify options of the engine are clamped; a hostile maxTotalWaitMs cannot stall the scheduler', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } }, { lag: { lamp: 99 } });
    const { engine, sleeps } = makeEngine(world, { verify: { retryDelayMs: 99999999, maxTotalWaitMs: 99999999 } });
    assert.strictEqual(engine._verify.retryDelayMs, 5000);
    assert.strictEqual(engine._verify.maxTotalWaitMs, 15000);
    await fire(engine, world, rule({}));
    assert.deepStrictEqual(sleeps, [5000]);
    const dflt = new RuleEngine({ deviceService: world.deviceService, ...createDefaultRegistries({}), log: { log() {}, error() {} } });
    assert.strictEqual(dflt._verify.retryDelayMs, 2000);
    assert.strictEqual(dflt._verify.maxTotalWaitMs, 10000);
  });

  await check('the action result line is ONE line even if the rule name contains newlines / control characters', async () => {
    const world = fakeWorld({ door: { contact: false }, lamp: { switch_1: false } });
    const { engine, logs } = makeEngine(world);
    const evil = rule({ name: 'evil\nname\r\n[rule-engine] fake line\u0000end' });
    await fire(engine, world, evil);
    const lines = logs.log.filter((l) => l.includes(' action command '));
    assert.strictEqual(lines.length, 1);
    const hasControlChar = Array.from(lines[0]).some((ch) => ch.charCodeAt(0) <= 0x1f || ch.charCodeAt(0) === 0x7f);
    assert.ok(!hasControlChar, JSON.stringify(lines[0]));
    assert.ok(lines[0].length <= 303);
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
