'use strict';

/** Unit tests for the `time` condition (at / from-to, incl. windows crossing midnight). */

const assert = require('assert');
const timeCondition = require('../../src/automation/conditions/timeCondition');

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

const at = (h, m) => new Date(2026, 5, 15, h, m, 30); // local time; seconds ignored
const evalAt = (node, h, m) => timeCondition.evaluate(node, { now: at(h, m) });
const validate = (node) => timeCondition.validate(node, { path: 'when' });

async function run() {
  console.log('=== time condition unit tests ===\n');

  await check('"at" is true only during exactly that minute', async () => {
    const node = { type: 'time', at: '18:00' };
    assert.strictEqual(await evalAt(node, 18, 0), true);
    assert.strictEqual(await evalAt(node, 17, 59), false);
    assert.strictEqual(await evalAt(node, 18, 1), false);
  });

  await check('window from-to: from inclusive, to exclusive', async () => {
    const node = { type: 'time', from: '11:00', to: '14:00' };
    assert.strictEqual(await evalAt(node, 10, 59), false);
    assert.strictEqual(await evalAt(node, 11, 0), true);
    assert.strictEqual(await evalAt(node, 12, 30), true);
    assert.strictEqual(await evalAt(node, 13, 59), true);
    assert.strictEqual(await evalAt(node, 14, 0), false);
  });

  await check('window crossing midnight (22:00 -> 06:00)', async () => {
    const node = { type: 'time', from: '22:00', to: '06:00' };
    assert.strictEqual(await evalAt(node, 21, 59), false);
    assert.strictEqual(await evalAt(node, 22, 0), true);
    assert.strictEqual(await evalAt(node, 23, 59), true);
    assert.strictEqual(await evalAt(node, 0, 0), true);
    assert.strictEqual(await evalAt(node, 5, 59), true);
    assert.strictEqual(await evalAt(node, 6, 0), false);
    assert.strictEqual(await evalAt(node, 12, 0), false);
  });

  await check('boundaries 00:00 and 23:59', async () => {
    assert.strictEqual(await evalAt({ type: 'time', at: '00:00' }, 0, 0), true);
    assert.strictEqual(await evalAt({ type: 'time', at: '23:59' }, 23, 59), true);
    assert.strictEqual(await evalAt({ type: 'time', at: '23:59' }, 0, 0), false);
    // "until end of day" is expressed as to = 00:00
    const rest = { type: 'time', from: '18:00', to: '00:00' };
    assert.strictEqual(await evalAt(rest, 23, 59), true);
    assert.strictEqual(await evalAt(rest, 0, 0), false);
  });

  await check('validate accepts good shapes and returns a clean copy', () => {
    assert.deepStrictEqual(validate({ type: 'time', at: '09:05' }), { type: 'time', at: '09:05' });
    assert.deepStrictEqual(validate({ type: 'time', from: '11:00', to: '14:00' }), {
      type: 'time',
      from: '11:00',
      to: '14:00',
    });
  });

  await check('validate rejects malformed / ambiguous input with VALIDATION_ERROR and a path', () => {
    const bad = [
      [{ type: 'time', at: '9:00' }, 'when.at'],
      [{ type: 'time', at: '24:00' }, 'when.at'],
      [{ type: 'time', at: '18:60' }, 'when.at'],
      [{ type: 'time', at: 1800 }, 'when.at'],
      [{ type: 'time' }, 'when'],
      [{ type: 'time', from: '11:00' }, 'when.to'],
      [{ type: 'time', to: '11:00' }, 'when.from'],
      [{ type: 'time', from: '11:00', to: '11:00' }, 'must differ'],
      [{ type: 'time', at: '10:00', from: '09:00', to: '11:00' }, 'not both'],
      [{ type: 'time', at: '10:00', extra: 1 }, 'when.extra'],
    ];
    for (const [node, fragment] of bad) {
      assert.throws(
        () => validate(node),
        (err) => err.code === 'VALIDATION_ERROR' && err.message.includes(fragment),
        JSON.stringify(node)
      );
    }
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
