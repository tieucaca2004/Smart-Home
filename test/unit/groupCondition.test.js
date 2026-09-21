'use strict';

/**
 * Unit tests for `and` / `or`: the full three-valued (true/false/null) truth
 * table, nesting, and short-circuiting (counted via the number of device reads).
 */

const assert = require('assert');
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

const { conditionRegistry } = createDefaultRegistries({});

/**
 * A leaf whose outcome is chosen by device id: "T" -> true, "F" -> false,
 * "N" -> unknown (unreadable). Counts reads per device.
 */
function harness() {
  const reads = [];
  const ctx = {
    now: new Date(2026, 5, 15, 12, 0, 0),
    location: null,
    readState: async (deviceId) => {
      reads.push(deviceId);
      if (deviceId.startsWith('N')) return null;
      return [{ code: 's', value: deviceId.startsWith('T') }];
    },
  };
  return { ctx, reads };
}
const leaf = (deviceId) => ({ type: 'device_state', deviceId, statusCode: 's', equals: true });
const group = (type, ...ids) => ({ type, conditions: ids.map(leaf) });

async function run() {
  console.log('=== and / or unit tests ===\n');

  // Kleene truth tables, all 9 combinations of (a, b).
  const V = { T: true, F: false, N: null };
  const andTable = { TT: true, TF: false, TN: null, FT: false, FF: false, FN: false, NT: null, NF: false, NN: null };
  const orTable = { TT: true, TF: true, TN: true, FT: true, FF: false, FN: null, NT: true, NF: null, NN: null };

  for (const [name, table] of [['and', andTable], ['or', orTable]]) {
    await check(`${name}: full 3-valued truth table (9 combinations)`, async () => {
      for (const [combo, expected] of Object.entries(table)) {
        const { ctx } = harness();
        const node = group(name, `${combo[0]}1`, `${combo[1]}2`);
        assert.strictEqual(await conditionRegistry.evaluate(node, ctx), expected, `${name}(${combo}) -> ${expected}`);
        assert.ok(V[combo[0]] !== undefined);
      }
    });
  }

  await check('and/or with three operands: unknown only matters when nothing decides the outcome', async () => {
    const { ctx } = harness();
    assert.strictEqual(await conditionRegistry.evaluate(group('and', 'T1', 'N1', 'F1'), ctx), false);
    assert.strictEqual(await conditionRegistry.evaluate(group('and', 'T1', 'N1', 'T2'), ctx), null);
    assert.strictEqual(await conditionRegistry.evaluate(group('or', 'F1', 'N1', 'T1'), ctx), true);
    assert.strictEqual(await conditionRegistry.evaluate(group('or', 'F1', 'N1', 'F2'), ctx), null);
    assert.strictEqual(await conditionRegistry.evaluate(group('and', 'T1'), ctx), true);
    assert.strictEqual(await conditionRegistry.evaluate(group('or', 'F1'), ctx), false);
  });

  await check('nested: (T and (F or T)) = true; (T and (F or F)) = false; (N or (T and T)) = true', async () => {
    const { ctx } = harness();
    const a = { type: 'and', conditions: [leaf('T1'), { type: 'or', conditions: [leaf('F1'), leaf('T2')] }] };
    const b = { type: 'and', conditions: [leaf('T1'), { type: 'or', conditions: [leaf('F1'), leaf('F2')] }] };
    const c = { type: 'or', conditions: [leaf('N1'), { type: 'and', conditions: [leaf('T1'), leaf('T2')] }] };
    assert.strictEqual(await conditionRegistry.evaluate(a, ctx), true);
    assert.strictEqual(await conditionRegistry.evaluate(b, ctx), false);
    assert.strictEqual(await conditionRegistry.evaluate(c, ctx), true);
  });

  await check('and short-circuits: after the first false, later conditions are never evaluated (no reads)', async () => {
    const { ctx, reads } = harness();
    const result = await conditionRegistry.evaluate(group('and', 'F1', 'T1', 'T2'), ctx);
    assert.strictEqual(result, false);
    assert.deepStrictEqual(reads, ['F1']);
  });

  await check('or short-circuits: after the first true, later conditions are never evaluated (no reads)', async () => {
    const { ctx, reads } = harness();
    const result = await conditionRegistry.evaluate(group('or', 'F1', 'T1', 'T2'), ctx);
    assert.strictEqual(result, true);
    assert.deepStrictEqual(reads, ['F1', 'T1']);
  });

  await check('and does NOT stop at an unknown: a later false still decides (false, not null)', async () => {
    const { ctx, reads } = harness();
    assert.strictEqual(await conditionRegistry.evaluate(group('and', 'N1', 'F1'), ctx), false);
    assert.deepStrictEqual(reads, ['N1', 'F1']);
  });

  await check('a time condition placed first spares the sensor read outside its window', async () => {
    const { ctx, reads } = harness();
    const rule = {
      type: 'and',
      conditions: [{ type: 'time', from: '13:00', to: '15:00' }, leaf('T1')], // ctx.now is 12:00
    };
    assert.strictEqual(await conditionRegistry.evaluate(rule, ctx), false);
    assert.deepStrictEqual(reads, []);
  });

  await check('trace() returns the evaluated tree (children only for what was actually evaluated)', async () => {
    const { ctx } = harness();
    const trace = await conditionRegistry.trace(group('and', 'F1', 'T1'), ctx);
    assert.strictEqual(trace.type, 'and');
    assert.strictEqual(trace.result, false);
    assert.strictEqual(trace.children.length, 1); // short-circuited after F1
    assert.strictEqual(trace.children[0].result, false);
  });

  await check('validate: empty / missing / non-array conditions and extra fields are rejected with a path', () => {
    for (const [node, fragment] of [
      [{ type: 'and', conditions: [] }, 'when.conditions must be a non-empty array'],
      [{ type: 'or' }, 'when.conditions must be a non-empty array'],
      [{ type: 'and', conditions: 'x' }, 'when.conditions'],
      [{ type: 'and', conditions: [leaf('a'), { type: 'time' }] }, 'when.conditions[1]'],
      [{ type: 'or', conditions: [leaf('a')], not: true }, 'when.not'],
    ]) {
      assert.throws(
        () => conditionRegistry.validateTree(node),
        (err) => err.code === 'VALIDATION_ERROR' && err.message.includes(fragment),
        JSON.stringify(node)
      );
    }
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
