'use strict';

/**
 * Unit tests for ConditionRegistry: registration, tree validation limits, and
 * - the point of the whole design - that a brand-new condition type can be
 * added and used without touching RuleEngine / AutomationService / scheduler.
 */

const assert = require('assert');
const ConditionRegistry = require('../../src/automation/ConditionRegistry');
const ActionRegistry = require('../../src/automation/ActionRegistry');
const RuleEngine = require('../../src/automation/RuleEngine');
const AutomationService = require('../../src/services/automationService');
const JsonFileStore = require('../../src/storage/JsonFileStore');
const createDefaultRegistries = require('../../src/automation/createDefaultRegistries');
const { LIMITS } = require('../../src/automation/schema');

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

function silentLog() {
  return { log: () => {}, error: () => {}, warn: () => {} };
}

function expectValidationError(fn, fragment) {
  try {
    fn();
  } catch (err) {
    assert.strictEqual(err.code, 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${err.code}: ${err.message}`);
    if (fragment) assert.ok(err.message.includes(fragment), `"${err.message}" should include "${fragment}"`);
    return;
  }
  assert.fail('expected a VALIDATION_ERROR but nothing was thrown');
}

/** A made-up condition type ("weekday"), defined only in this test file. */
const weekdayCondition = {
  type: 'weekday',
  validate(node, { path }) {
    if (!Number.isInteger(node.day) || node.day < 0 || node.day > 6) {
      const err = new Error(`${path}.day must be 0..6`);
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    return { type: 'weekday', day: node.day };
  },
  async evaluate(node, ctx) {
    return ctx.now.getDay() === node.day;
  },
};

function nested(depth) {
  let node = { type: 'time', at: '10:00' };
  for (let i = 1; i < depth; i += 1) node = { type: 'and', conditions: [node] };
  return node;
}

async function run() {
  console.log('=== ConditionRegistry unit tests ===\n');

  await check('default registry knows every Sprint 6 condition type', () => {
    const { conditionRegistry } = createDefaultRegistries({});
    for (const type of ['time', 'temperature', 'humidity', 'device_state', 'motion', 'door', 'sun', 'and', 'or']) {
      assert.ok(conditionRegistry.has(type), `missing ${type}`);
    }
  });

  await check('registering the same type twice is an error', () => {
    const registry = new ConditionRegistry().register(weekdayCondition);
    assert.throws(() => registry.register(weekdayCondition), /already registered/);
  });

  await check('registering a malformed evaluator is an error', () => {
    const registry = new ConditionRegistry();
    assert.throws(() => registry.register({ type: 'x' }), /validate\(\) and evaluate\(\)/);
    assert.throws(() => registry.register(null), /non-empty string "type"/);
  });

  await check('unknown type -> VALIDATION_ERROR naming the path and the supported types', () => {
    const { conditionRegistry } = createDefaultRegistries({});
    expectValidationError(() => conditionRegistry.validateTree({ type: 'lunar' }), 'when.type "lunar"');
    expectValidationError(() => conditionRegistry.validateTree({ type: 'and', conditions: [{ type: 'lunar' }] }), 'when.conditions[0].type');
  });

  await check('non-object / missing type -> VALIDATION_ERROR', () => {
    const { conditionRegistry } = createDefaultRegistries({});
    expectValidationError(() => conditionRegistry.validateTree('nope'), 'must be an object');
    expectValidationError(() => conditionRegistry.validateTree({}), 'when.type');
    expectValidationError(() => conditionRegistry.validateTree([]), 'must be an object');
  });

  await check(`nesting deeper than ${LIMITS.MAX_DEPTH} is rejected, exactly ${LIMITS.MAX_DEPTH} is accepted`, () => {
    const { conditionRegistry } = createDefaultRegistries({});
    conditionRegistry.validateTree(nested(LIMITS.MAX_DEPTH));
    expectValidationError(() => conditionRegistry.validateTree(nested(LIMITS.MAX_DEPTH + 1)), 'nested deeper');
  });

  await check(`more than ${LIMITS.MAX_NODES} nodes is rejected, exactly ${LIMITS.MAX_NODES} is accepted`, () => {
    const { conditionRegistry } = createDefaultRegistries({});
    const leaf = { type: 'time', at: '10:00' };
    const ok = { type: 'or', conditions: Array.from({ length: LIMITS.MAX_NODES - 1 }, () => leaf) }; // 1 + 29 = 30
    conditionRegistry.validateTree(ok);
    const tooMany = { type: 'or', conditions: Array.from({ length: LIMITS.MAX_NODES }, () => leaf) }; // 31
    expectValidationError(() => conditionRegistry.validateTree(tooMany), 'more than');
  });

  await check('evaluate() turns an exception inside an evaluator into null (never throws)', async () => {
    const registry = new ConditionRegistry().register({
      type: 'boom',
      validate: (n) => n,
      evaluate: async () => { throw new Error('kaput'); },
    });
    const trace = await registry.trace({ type: 'boom' }, { now: new Date() });
    assert.strictEqual(trace.result, null);
    assert.strictEqual(trace.error, 'kaput');
    assert.strictEqual(await registry.evaluate({ type: 'nope' }, { now: new Date() }), null);
  });

  await check('EXTENSIBILITY: a custom condition type works end to end without touching engine/service/scheduler', async () => {
    // Custom registries: the defaults plus one new type. No source file was edited.
    const sceneService = { async getScene() { return { id: 's1' }; } };
    const { conditionRegistry, actionRegistry } = createDefaultRegistries({ sceneService });
    conditionRegistry.register(weekdayCondition);

    // 1. Validation through the (unmodified) AutomationService, also nested in an "and".
    const service = new AutomationService(new JsonFileStore(), sceneService, { conditionRegistry, actionRegistry });
    const created = await service.createAutomation({
      name: 'weekday rule',
      enabled: true,
      when: { type: 'and', conditions: [{ type: 'weekday', day: 3 }, { type: 'time', at: '10:00' }] },
      then: [{ type: 'scene', sceneId: 's1' }],
    });
    assert.strictEqual(created.when.conditions[0].type, 'weekday');
    await assert.rejects(
      service.createAutomation({ name: 'bad', enabled: true, when: { type: 'weekday', day: 9 }, then: [{ type: 'scene', sceneId: 's1' }] }),
      /day must be 0..6/
    );

    // 2. Evaluation through the (unmodified) RuleEngine.
    const engine = new RuleEngine({ deviceService: {}, conditionRegistry, actionRegistry: new ActionRegistry(), log: silentLog() });
    const wednesday = new Date(2026, 8, 23, 10, 0, 0); // 2026-09-23 is a Wednesday (getDay() === 3)
    assert.strictEqual(wednesday.getDay(), 3);
    assert.strictEqual((await engine.evaluateRule(created, wednesday)).result, true);
    assert.strictEqual((await engine.evaluateRule(created, new Date(2026, 8, 24, 10, 0, 0))).result, false);
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
