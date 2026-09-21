'use strict';

/**
 * API tests for Sprint 6 rules on /api/automations - in-process HTTP against a
 * fake protocol adapter (no network). Covers rule create/read/update/delete,
 * the legacy-vs-rule visibility contract, the 409 guard, and the read-only
 * POST /api/automations/:id/evaluate dry run.
 */

const http = require('http');
const assert = require('assert');
const createApp = require('../../src/app');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceAdapter = require('../../src/adapters/DeviceAdapter');
const DeviceService = require('../../src/services/deviceService');

/** Fake adapter: two devices with mutable status; counts commands so dry runs can be proven side-effect free. */
class FakeAdapter extends DeviceAdapter {
  constructor() {
    super();
    this.status = { door: { contact: true }, lamp: { switch_1: false } };
    this.commandCount = 0;
  }
  get protocol() {
    return 'fake';
  }
  async getDevices() {
    return [];
  }
  async getDeviceStatus(nativeId) {
    if (!this.status[nativeId]) {
      const err = new Error('not found');
      err.appCode = 'DEVICE_NOT_FOUND';
      throw err;
    }
    return Object.entries(this.status[nativeId]).map(([code, value]) => ({ code, value }));
  }
  async sendCommand(nativeId, code, value) {
    this.commandCount += 1;
    this.status[nativeId][code] = value;
    return true;
  }
}

function buildTestApp(extra) {
  const adapter = new FakeAdapter();
  const registry = new AdapterRegistry();
  registry.register(adapter);
  return { adapter, app: createApp(new DeviceService(registry), extra) };
}

function requestJson(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch (err) {
            // leave json = null on parse failure
          }
          resolve({ statusCode: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

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
  console.log('=== Automation rules API tests (in-process, fake adapter, no network) ===\n');

  const { adapter, app } = buildTestApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const scene = (
    await requestJson(server, 'POST', '/api/scenes', {
      name: 'Lamp on',
      actions: [{ deviceId: 'fake:lamp', functionCode: 'switch_1', value: true }],
    })
  ).body.scene;

  const legacyPayload = { name: 'Daily 18:00', enabled: true, trigger: { type: 'daily', time: '18:00' }, sceneId: scene.id };
  const rulePayload = {
    name: 'Door open -> lamp',
    enabled: true,
    when: { type: 'and', conditions: [
      { type: 'door', deviceId: 'fake:door', statusCode: 'contact', equals: true },
      // "any time of day", written as two windows so this test never depends on the clock
      { type: 'or', conditions: [{ type: 'time', from: '00:00', to: '12:00' }, { type: 'time', from: '12:00', to: '00:00' }] },
    ] },
    then: [
      { type: 'command', deviceId: 'fake:lamp', functionCode: 'switch_1', value: true },
      { type: 'scene', sceneId: scene.id },
    ],
  };

  const legacy = (await requestJson(server, 'POST', '/api/automations', legacyPayload)).body.automation;
  let rule;

  await check('POST a valid rule -> 201 with schemaVersion 2, when/then and no legacy keys', async () => {
    const res = await requestJson(server, 'POST', '/api/automations', rulePayload);
    assert.strictEqual(res.statusCode, 201);
    rule = res.body.automation;
    assert.strictEqual(rule.schemaVersion, 2);
    assert.strictEqual(rule.when.type, 'and');
    assert.strictEqual(rule.then.length, 2);
    assert.strictEqual(rule.trigger, undefined);
    assert.strictEqual(rule.sceneId, undefined);
  });

  await check('POST invalid rules -> 400 VALIDATION_ERROR with a helpful path', async () => {
    const cases = [
      [{ ...rulePayload, when: { type: 'lunar' } }, 'when.type'],
      [{ ...rulePayload, then: [] }, 'then'],
      [{ ...rulePayload, when: { type: 'time', at: '25:00' } }, 'when.at'],
      [{ ...rulePayload, sceneId: scene.id }, 'mixes'],
      [{ ...rulePayload, when: { type: 'sun', event: 'sunrise', relation: 'after' } }, 'HUB_LATITUDE'],
    ];
    for (const [body, fragment] of cases) {
      const res = await requestJson(server, 'POST', '/api/automations', body);
      assert.strictEqual(res.statusCode, 400, JSON.stringify(body));
      assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error.includes(fragment), `${res.body.error} should include ${fragment}`);
    }
  });

  await check('POST a rule with a missing scene -> 404 SCENE_NOT_FOUND', async () => {
    const res = await requestJson(server, 'POST', '/api/automations', {
      ...rulePayload,
      then: [{ type: 'scene', sceneId: 'does-not-exist' }],
    });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'SCENE_NOT_FOUND');
  });

  await check('GET /api/automations (default) hides rules: only Sprint 5 shaped records, all with trigger + sceneId', async () => {
    const res = await requestJson(server, 'GET', '/api/automations');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.automations.map((a) => a.id), [legacy.id]);
    for (const a of res.body.automations) {
      assert.ok(a.trigger && a.trigger.time && a.sceneId);
    }
  });

  await check('GET /api/automations?include=all shows legacy and rules', async () => {
    const res = await requestJson(server, 'GET', '/api/automations?include=all');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.automations.map((a) => a.id), [legacy.id, rule.id]);
  });

  await check('GET /api/automations?include=other behaves like the default', async () => {
    const res = await requestJson(server, 'GET', '/api/automations?include=rules');
    assert.deepStrictEqual(res.body.automations.map((a) => a.id), [legacy.id]);
  });

  await check('GET /api/automations/:id returns a rule by id', async () => {
    const res = await requestJson(server, 'GET', `/api/automations/${rule.id}`);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.automation, rule);
  });

  await check('PUT a legacy payload onto a rule -> 409 AUTOMATION_SCHEMA_MISMATCH and the rule is unchanged', async () => {
    const res = await requestJson(server, 'PUT', `/api/automations/${rule.id}`, { ...legacyPayload, enabled: false });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.code, 'AUTOMATION_SCHEMA_MISMATCH');
    const after = await requestJson(server, 'GET', `/api/automations/${rule.id}`);
    assert.deepStrictEqual(after.body.automation, rule);
  });

  await check('PUT a legacy payload onto a legacy record still works (Sprint 5 contract)', async () => {
    const res = await requestJson(server, 'PUT', `/api/automations/${legacy.id}`, { ...legacyPayload, enabled: false });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.automation.enabled, false);
    assert.strictEqual(res.body.automation.schemaVersion, undefined);
  });

  await check('PUT a rule payload onto a rule replaces it (200)', async () => {
    const res = await requestJson(server, 'PUT', `/api/automations/${rule.id}`, { ...rulePayload, name: 'Renamed', enabled: false });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.automation.name, 'Renamed');
    assert.strictEqual(res.body.automation.enabled, false);
    rule = res.body.automation;
  });

  await check('POST /:id/evaluate -> 200 { result, tree } from live fake state, and runs NO action', async () => {
    const before = adapter.commandCount;
    const res = await requestJson(server, 'POST', `/api/automations/${rule.id}/evaluate`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.automationId, rule.id);
    assert.strictEqual(res.body.result, true);
    assert.strictEqual(res.body.tree.type, 'and');
    assert.deepStrictEqual(res.body.tree.children.map((c) => [c.type, c.result]), [['door', true], ['or', true]]);
    assert.strictEqual(adapter.commandCount, before);
    assert.strictEqual(adapter.status.lamp.switch_1, false);
  });

  await check('POST /:id/evaluate reflects changed device state, and unreadable devices give null (not an error)', async () => {
    adapter.status.door.contact = false;
    let res = await requestJson(server, 'POST', `/api/automations/${rule.id}/evaluate`);
    assert.strictEqual(res.body.result, false);
    delete adapter.status.door; // device disappears -> cannot be read
    res = await requestJson(server, 'POST', `/api/automations/${rule.id}/evaluate`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.result, null);
    assert.strictEqual(res.body.tree.children[0].result, null);
    adapter.status.door = { contact: true };
  });

  await check('POST /:id/evaluate on a legacy automation -> 200 legacy:true, result null, no tree', async () => {
    const res = await requestJson(server, 'POST', `/api/automations/${legacy.id}/evaluate`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.legacy, true);
    assert.strictEqual(res.body.result, null);
    assert.strictEqual(res.body.tree, null);
  });

  await check('POST /:id/evaluate with an unknown id -> 404 AUTOMATION_NOT_FOUND', async () => {
    const res = await requestJson(server, 'POST', '/api/automations/does-not-exist/evaluate');
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'AUTOMATION_NOT_FOUND');
  });

  await check('DELETE a rule -> 204, then 404; the legacy record is unaffected', async () => {
    const del = await requestJson(server, 'DELETE', `/api/automations/${rule.id}`);
    assert.strictEqual(del.statusCode, 204);
    assert.strictEqual((await requestJson(server, 'GET', `/api/automations/${rule.id}`)).statusCode, 404);
    const list = await requestJson(server, 'GET', '/api/automations?include=all');
    assert.deepStrictEqual(list.body.automations.map((a) => a.id), [legacy.id]);
  });

  await new Promise((resolve) => server.close(resolve));

  // --- with a Hub location configured, sun conditions are accepted and evaluated ---
  const located = buildTestApp({ location: { latitude: 21.03, longitude: 105.85 } });
  const server2 = located.app.listen(0);
  await new Promise((resolve) => server2.once('listening', resolve));

  await check('with a location configured: a sun rule is accepted and /evaluate returns a boolean (never null)', async () => {
    const scene2 = (
      await requestJson(server2, 'POST', '/api/scenes', {
        name: 'S', actions: [{ deviceId: 'fake:lamp', functionCode: 'switch_1', value: true }],
      })
    ).body.scene;
    const created = await requestJson(server2, 'POST', '/api/automations', {
      name: 'Sunset lights',
      enabled: true,
      when: { type: 'sun', event: 'sunset', relation: 'after', offsetMinutes: -10 },
      then: [{ type: 'scene', sceneId: scene2.id }],
    });
    assert.strictEqual(created.statusCode, 201);
    const res = await requestJson(server2, 'POST', `/api/automations/${created.body.automation.id}/evaluate`);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.result === true || res.body.result === false);
  });

  await new Promise((resolve) => server2.close(resolve));

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
