'use strict';

/**
 * Unit tests for temperature / humidity (numeric comparison with scale) and
 * device_state / motion / door (equality). Device reads go through a fake
 * `ctx.readState`, so no service, adapter or network is involved.
 */

const assert = require('assert');
const { temperatureCondition, humidityCondition } = require('../../src/automation/conditions/numericStateCondition');
const { deviceStateCondition, motionCondition, doorCondition } = require('../../src/automation/conditions/deviceStateCondition');

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

const ctxWith = (status) => ({ now: new Date(), readState: async () => status });
const validate = (evaluator, node) => evaluator.validate(node, { path: 'when' });
const expectInvalid = (evaluator, node, fragment) =>
  assert.throws(
    () => validate(evaluator, node),
    (err) => err.code === 'VALIDATION_ERROR' && err.message.includes(fragment),
    JSON.stringify(node)
  );

async function run() {
  console.log('=== temperature / humidity / device_state / motion / door unit tests ===\n');

  const temp = (operator, value, extra) => ({
    type: 'temperature',
    deviceId: 'dev:1',
    statusCode: 'sensor_temp',
    operator,
    value,
    ...extra,
  });

  await check('all six operators (raw reading 30, scale 0)', async () => {
    const ctx = ctxWith([{ code: 'sensor_temp', value: 30 }]);
    const expected = {
      '>': [29, true, 30, false, 31, false],
      '>=': [29, true, 30, true, 31, false],
      '<': [29, false, 30, false, 31, true],
      '<=': [29, false, 30, true, 31, true],
      '==': [29, false, 30, true, 31, false],
      '!=': [29, true, 30, false, 31, true],
    };
    for (const [op, flat] of Object.entries(expected)) {
      for (let i = 0; i < flat.length; i += 2) {
        assert.strictEqual(
          await temperatureCondition.evaluate(temp(op, flat[i]), ctx),
          flat[i + 1],
          `30 ${op} ${flat[i]}`
        );
      }
    }
  });

  await check('scale: raw 361 with scale 1 is 36.1, so "> 35" is true and "> 36.1" is false', async () => {
    const ctx = ctxWith([{ code: 'sensor_temp', value: 361 }]);
    assert.strictEqual(await temperatureCondition.evaluate(temp('>', 35, { scale: 1 }), ctx), true);
    assert.strictEqual(await temperatureCondition.evaluate(temp('>', 36.1, { scale: 1 }), ctx), false);
    assert.strictEqual(await temperatureCondition.evaluate(temp('==', 36.1, { scale: 1 }), ctx), true);
    // without scale the same raw 361 is compared as 361
    assert.strictEqual(await temperatureCondition.evaluate(temp('>', 35), ctx), true);
    assert.strictEqual(await temperatureCondition.evaluate(temp('<', 100), ctx), false);
  });

  await check('humidity behaves like temperature (separate type, same comparison)', async () => {
    const node = { type: 'humidity', deviceId: 'dev:1', statusCode: 'sensor_hum', operator: '<', value: 40, scale: 0 };
    assert.strictEqual(await humidityCondition.evaluate(node, ctxWith([{ code: 'sensor_hum', value: 35 }])), true);
    assert.strictEqual(await humidityCondition.evaluate(node, ctxWith([{ code: 'sensor_hum', value: 55 }])), false);
    assert.strictEqual(validate(humidityCondition, { ...node }).type, 'humidity');
  });

  await check('numeric: missing status code, non-numeric value, unreadable device -> null (unknown)', async () => {
    const node = temp('>', 35);
    assert.strictEqual(await temperatureCondition.evaluate(node, ctxWith([{ code: 'other', value: 40 }])), null);
    assert.strictEqual(await temperatureCondition.evaluate(node, ctxWith([{ code: 'sensor_temp', value: 'hot' }])), null);
    assert.strictEqual(await temperatureCondition.evaluate(node, ctxWith([{ code: 'sensor_temp', value: NaN }])), null);
    assert.strictEqual(await temperatureCondition.evaluate(node, ctxWith([{ code: 'sensor_temp', value: true }])), null);
    assert.strictEqual(await temperatureCondition.evaluate(node, ctxWith([{ code: 'sensor_temp' }])), null);
    assert.strictEqual(await temperatureCondition.evaluate(node, ctxWith(null)), null);
    assert.strictEqual(await temperatureCondition.evaluate(node, ctxWith('garbage')), null);
  });

  await check('numeric validate: defaults scale to 0, trims ids, rejects bad fields', () => {
    const clean = validate(temperatureCondition, {
      type: 'temperature', deviceId: ' dev:1 ', statusCode: 'c', operator: '>=', value: 35,
    });
    assert.deepStrictEqual(clean, { type: 'temperature', deviceId: 'dev:1', statusCode: 'c', operator: '>=', value: 35, scale: 0 });
    const base = { type: 'temperature', deviceId: 'd', statusCode: 'c', operator: '>', value: 1 };
    expectInvalid(temperatureCondition, { ...base, deviceId: '' }, 'when.deviceId');
    expectInvalid(temperatureCondition, { ...base, statusCode: 3 }, 'when.statusCode');
    expectInvalid(temperatureCondition, { ...base, operator: '=>' }, 'when.operator');
    expectInvalid(temperatureCondition, { ...base, value: '35' }, 'when.value must be a finite number');
    expectInvalid(temperatureCondition, { ...base, value: Infinity }, 'when.value');
    expectInvalid(temperatureCondition, { ...base, scale: 1.5 }, 'when.scale');
    expectInvalid(temperatureCondition, { ...base, scale: 7 }, 'when.scale');
    expectInvalid(temperatureCondition, { ...base, scale: -1 }, 'when.scale');
    expectInvalid(temperatureCondition, { ...base, unit: 'C' }, 'when.unit');
  });

  const state = (type, equals) => ({ type, deviceId: 'dev:2', statusCode: 'st', equals });

  await check('device_state: equals true/false/number/string with strict comparison', async () => {
    assert.strictEqual(await deviceStateCondition.evaluate(state('device_state', true), ctxWith([{ code: 'st', value: true }])), true);
    assert.strictEqual(await deviceStateCondition.evaluate(state('device_state', true), ctxWith([{ code: 'st', value: false }])), false);
    assert.strictEqual(await deviceStateCondition.evaluate(state('device_state', false), ctxWith([{ code: 'st', value: false }])), true);
    assert.strictEqual(await deviceStateCondition.evaluate(state('device_state', 3), ctxWith([{ code: 'st', value: 3 }])), true);
    assert.strictEqual(await deviceStateCondition.evaluate(state('device_state', 'open'), ctxWith([{ code: 'st', value: 'open' }])), true);
    assert.strictEqual(await deviceStateCondition.evaluate(state('device_state', 'open'), ctxWith([{ code: 'st', value: 'closed' }])), false);
    // strict: the string "true" is not the boolean true, 1 is not true
    assert.strictEqual(await deviceStateCondition.evaluate(state('device_state', true), ctxWith([{ code: 'st', value: 'true' }])), false);
    assert.strictEqual(await deviceStateCondition.evaluate(state('device_state', true), ctxWith([{ code: 'st', value: 1 }])), false);
  });

  await check('motion and door use the same equality semantics', async () => {
    assert.strictEqual(await motionCondition.evaluate(state('motion', 'pir'), ctxWith([{ code: 'st', value: 'pir' }])), true);
    assert.strictEqual(await motionCondition.evaluate(state('motion', 'pir'), ctxWith([{ code: 'st', value: 'none' }])), false);
    assert.strictEqual(await doorCondition.evaluate(state('door', true), ctxWith([{ code: 'st', value: true }])), true);
    assert.strictEqual(await doorCondition.evaluate(state('door', true), ctxWith([{ code: 'st', value: false }])), false);
    assert.strictEqual(validate(doorCondition, state('door', true)).type, 'door');
    assert.strictEqual(validate(motionCondition, state('motion', true)).type, 'motion');
  });

  await check('equality: missing status code, null value, unreadable device -> null (unknown)', async () => {
    const node = state('device_state', true);
    assert.strictEqual(await deviceStateCondition.evaluate(node, ctxWith([{ code: 'other', value: true }])), null);
    assert.strictEqual(await deviceStateCondition.evaluate(node, ctxWith([{ code: 'st', value: null }])), null);
    assert.strictEqual(await deviceStateCondition.evaluate(node, ctxWith([{ code: 'st' }])), null);
    assert.strictEqual(await deviceStateCondition.evaluate(node, ctxWith([])), null);
    assert.strictEqual(await deviceStateCondition.evaluate(node, ctxWith(null)), null);
  });

  await check('equality validate: rejects bad equals / ids / extra fields', () => {
    expectInvalid(deviceStateCondition, state('device_state', null), 'when.equals');
    expectInvalid(deviceStateCondition, state('device_state', { a: 1 }), 'when.equals');
    expectInvalid(deviceStateCondition, state('device_state', NaN), 'when.equals');
    expectInvalid(deviceStateCondition, { ...state('device_state', true), deviceId: ' ' }, 'when.deviceId');
    expectInvalid(deviceStateCondition, { ...state('device_state', true), statusCode: undefined }, 'when.statusCode');
    expectInvalid(deviceStateCondition, { ...state('device_state', true), foo: 1 }, 'when.foo');
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
