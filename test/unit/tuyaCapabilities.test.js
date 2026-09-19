'use strict';

/**
 * Offline unit tests for the capabilities feature on the Tuya side:
 *   - TuyaAdapter.getDeviceCapabilities()  (request construction + normalization)
 *   - normalizeTuyaCapabilities            (pure parsing helpers)
 *   - wrapWithErrorNormalization           (forwards getDeviceCapabilities and tags failures)
 *
 * No network, no real credentials: the HTTPS call is replaced by an injected
 * fake transport. The fixtures below are SYNTHETIC — shaped like Tuya's
 * documented "Get the specifications and properties of the device" response
 * (GET /v1.0/iot-03/devices/{device_id}/specification), NOT a recording of
 * any real device's actual specification.
 */

const assert = require('assert');
const TuyaAdapter = require('../../src/adapters/tuya/TuyaAdapter');
const {
  normalizeTuyaSpecification,
  parseTuyaValues,
} = require('../../src/adapters/tuya/normalizeTuyaCapabilities');
const { wrapWithErrorNormalization } = require('../../src/adapters/tuya/normalizeTuyaErrors');

const DUMMY_ACCESS_ID = 'dummy_access_id';
const DUMMY_ACCESS_SECRET = 'super-secret-DO-NOT-LEAK';
const DUMMY_TOKEN = 'tok-abc-999-DO-NOT-LEAK';

const TOKEN_RESPONSE = {
  statusCode: 200,
  body: { success: true, result: { access_token: DUMMY_TOKEN, expire_time: 7200 } },
};

const SPEC_RESULT = {
  category: 'kg',
  functions: [
    { code: 'switch_1', name: 'Switch 1', type: 'Boolean', values: '{}' },
    {
      code: 'countdown_1',
      name: 'Countdown 1',
      type: 'Integer',
      values: '{"unit":"s","min":0,"max":86400,"scale":0,"step":1}',
    },
    { code: 'relay_status', name: 'Power-on behavior', type: 'Enum', values: '{"range":["off","on","memory"]}' },
  ],
  status: [
    { code: 'switch_1', name: 'Switch 1', type: 'Boolean', values: '{}' },
    { code: 'cur_power', name: 'Power', type: 'Integer', values: '{"unit":"W","min":0,"max":99999,"scale":1,"step":1}' },
  ],
};

const DETAIL_RESULT = { name: 'Synthetic Light', category: 'kg', is_online: true };

const specPath = (id) => `/v1.0/iot-03/devices/${id}/specification`;
const detailPath = (id) => `/v2.0/cloud/thing/${id}`;

/** Fake transport: token path is answered automatically; other paths come from `byPath`. Records every call. */
function makeHttp(byPath) {
  const calls = [];
  const fn = async (baseUrl, req) => {
    calls.push({ baseUrl, method: req.method, path: req.path, body: req.body, headers: req.headers });
    if (req.path.startsWith('/v1.0/token')) return TOKEN_RESPONSE;
    const res = byPath[req.path];
    if (!res) throw new Error(`makeHttp: unexpected path ${req.path}`);
    return res;
  };
  fn.calls = calls;
  return fn;
}

const ok = (result) => ({ statusCode: 200, body: { success: true, result } });
const fail = (code, msg) => ({ statusCode: 200, body: { success: false, code, msg } });

function makeAdapter(byPath) {
  const http = makeHttp(byPath);
  const adapter = new TuyaAdapter({
    accessId: DUMMY_ACCESS_ID,
    accessSecret: DUMMY_ACCESS_SECRET,
    httpRequest: http,
  });
  return { adapter, http };
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
    console.log(`      ${err.message}`);
    failCount += 1;
  }
}

async function run() {
  console.log('=== Tuya capabilities unit tests (no network, no real credentials) ===\n');

  // ---- request construction -------------------------------------------------

  await check('getDeviceCapabilities() calls token, then GET .../specification, then GET device details', async () => {
    const { adapter, http } = makeAdapter({
      [specPath('dev123')]: ok(SPEC_RESULT),
      [detailPath('dev123')]: ok(DETAIL_RESULT),
    });
    await adapter.getDeviceCapabilities('dev123');
    assert.deepStrictEqual(
      http.calls.map((c) => `${c.method} ${c.path}`),
      ['GET /v1.0/token?grant_type=1', `GET ${specPath('dev123')}`, `GET ${detailPath('dev123')}`]
    );
  });

  await check('getDeviceCapabilities() is read-only: every call is a GET, no body, never touches /commands', async () => {
    const { adapter, http } = makeAdapter({
      [specPath('dev123')]: ok(SPEC_RESULT),
      [detailPath('dev123')]: ok(DETAIL_RESULT),
    });
    await adapter.getDeviceCapabilities('dev123');
    assert.strictEqual(http.calls.every((c) => c.method === 'GET'), true);
    assert.strictEqual(http.calls.every((c) => c.body === undefined || c.body === null), true);
    assert.strictEqual(http.calls.some((c) => c.path.includes('/commands')), false);
  });

  await check('getDeviceCapabilities() sends the standard signed headers (and never the secret)', async () => {
    const { adapter, http } = makeAdapter({
      [specPath('dev123')]: ok(SPEC_RESULT),
      [detailPath('dev123')]: ok(DETAIL_RESULT),
    });
    await adapter.getDeviceCapabilities('dev123');
    const h = http.calls[1].headers;
    assert.strictEqual(h.client_id, DUMMY_ACCESS_ID);
    assert.strictEqual(h.access_token, DUMMY_TOKEN);
    assert.strictEqual(h.sign_method, 'HMAC-SHA256');
    assert.match(h.t, /^\d+$/);
    assert.match(h.sign, /^[0-9A-F]{64}$/);
    for (const call of http.calls) {
      assert.strictEqual(JSON.stringify(call).includes(DUMMY_ACCESS_SECRET), false);
    }
  });

  await check('getDeviceCapabilities() URL-encodes the native id in the path (no path traversal)', async () => {
    const encoded = 'a%2F..%2Fb';
    const { adapter, http } = makeAdapter({
      [specPath(encoded)]: ok(SPEC_RESULT),
      [detailPath(encoded)]: ok(DETAIL_RESULT),
    });
    await adapter.getDeviceCapabilities('a/../b');
    assert.strictEqual(http.calls[1].path, specPath(encoded));
    assert.strictEqual(http.calls[1].path.includes('/../'), false);
  });

  await check('getDeviceCapabilities() rejects a missing nativeId before any HTTP call', async () => {
    const { adapter, http } = makeAdapter({});
    await assert.rejects(() => adapter.getDeviceCapabilities(undefined), /nativeId is required/);
    assert.strictEqual(http.calls.length, 0);
  });

  // ---- normalization --------------------------------------------------------

  await check('getDeviceCapabilities() returns the normalized shape', async () => {
    const { adapter } = makeAdapter({
      [specPath('dev123')]: ok(SPEC_RESULT),
      [detailPath('dev123')]: ok(DETAIL_RESULT),
    });
    const caps = await adapter.getDeviceCapabilities('dev123');
    assert.deepStrictEqual(caps, {
      nativeId: 'dev123',
      protocol: 'tuya',
      name: 'Synthetic Light',
      category: 'kg',
      online: true,
      commands: [
        { code: 'switch_1', type: 'Boolean', name: 'Switch 1', values: {} },
        {
          code: 'countdown_1',
          type: 'Integer',
          name: 'Countdown 1',
          values: { unit: 's', min: 0, max: 86400, scale: 0, step: 1 },
        },
        { code: 'relay_status', type: 'Enum', name: 'Power-on behavior', values: { range: ['off', 'on', 'memory'] } },
      ],
      statuses: [
        { code: 'switch_1', type: 'Boolean', name: 'Switch 1', values: {} },
        { code: 'cur_power', type: 'Integer', name: 'Power', values: { unit: 'W', min: 0, max: 99999, scale: 1, step: 1 } },
      ],
    });
  });

  await check('does not invent capabilities: only codes returned by the API appear', async () => {
    const { adapter } = makeAdapter({
      [specPath('dev123')]: ok({ category: 'kg', functions: [{ code: 'switch_1', type: 'Boolean', values: '{}' }] }),
      [detailPath('dev123')]: ok(DETAIL_RESULT),
    });
    const caps = await adapter.getDeviceCapabilities('dev123');
    assert.deepStrictEqual(caps.commands.map((c) => c.code), ['switch_1']);
    assert.deepStrictEqual(caps.statuses, []);
  });

  await check('missing functions/status arrays normalize to empty arrays (not undefined)', async () => {
    const { adapter } = makeAdapter({
      [specPath('dev123')]: ok({ category: 'wsdcg' }),
      [detailPath('dev123')]: ok(DETAIL_RESULT),
    });
    const caps = await adapter.getDeviceCapabilities('dev123');
    assert.deepStrictEqual(caps.commands, []);
    assert.deepStrictEqual(caps.statuses, []);
  });

  await check('category falls back to device details when the specification has none', async () => {
    const { adapter } = makeAdapter({
      [specPath('dev123')]: ok({ functions: [], status: [] }),
      [detailPath('dev123')]: ok(DETAIL_RESULT),
    });
    const caps = await adapter.getDeviceCapabilities('dev123');
    assert.strictEqual(caps.category, 'kg');
  });

  await check('a failing device-details lookup is tolerated: name/online are simply omitted', async () => {
    const { adapter } = makeAdapter({
      [specPath('dev123')]: ok(SPEC_RESULT),
      [detailPath('dev123')]: fail(1106, 'permission deny'),
    });
    const caps = await adapter.getDeviceCapabilities('dev123');
    assert.strictEqual('name' in caps, false);
    assert.strictEqual('online' in caps, false);
    assert.strictEqual(caps.category, 'kg'); // still available from the specification itself
    assert.strictEqual(caps.commands.length, 3);
  });

  // ---- pure helpers ---------------------------------------------------------

  await check('parseTuyaValues: "{}" -> {}, valid JSON object -> object', () => {
    assert.deepStrictEqual(parseTuyaValues('{}'), {});
    assert.deepStrictEqual(parseTuyaValues('{"min":0,"max":10}'), { min: 0, max: 10 });
  });

  await check('parseTuyaValues: absent/empty -> {}; unparseable or non-object -> null (never throws)', () => {
    assert.deepStrictEqual(parseTuyaValues(undefined), {});
    assert.deepStrictEqual(parseTuyaValues(''), {});
    assert.strictEqual(parseTuyaValues('{not json'), null);
    assert.strictEqual(parseTuyaValues('"just a string"'), null);
    assert.strictEqual(parseTuyaValues('[1,2]'), null);
  });

  await check('normalizeTuyaSpecification: skips entries without a string code, omits empty name/desc', () => {
    const out = normalizeTuyaSpecification({
      functions: [
        null,
        'oops',
        { type: 'Boolean', values: '{}' },
        { code: '', type: 'Boolean' },
        { code: 'switch_1', type: 'Boolean', name: '', desc: '', values: '{}' },
        { code: 'mode', type: 'Enum', desc: 'Working mode', values: '{"range":["a"]}' },
      ],
    });
    assert.deepStrictEqual(out.commands, [
      { code: 'switch_1', type: 'Boolean', values: {} },
      { code: 'mode', type: 'Enum', desc: 'Working mode', values: { range: ['a'] } },
    ]);
  });

  // ---- error propagation + normalization wrapper ----------------------------

  await check('a failing specification call throws the Tuya error (code preserved) and skips the details call', async () => {
    const { adapter, http } = makeAdapter({ [specPath('dev123')]: fail(1106, 'permission deny') });
    await assert.rejects(
      () => adapter.getDeviceCapabilities('dev123'),
      (err) => err.code === 1106 && /permission deny/.test(err.message)
    );
    assert.strictEqual(http.calls.length, 2); // token + specification only
  });

  await check('wrapWithErrorNormalization forwards getDeviceCapabilities() and returns the result unchanged', async () => {
    const { adapter } = makeAdapter({
      [specPath('dev123')]: ok(SPEC_RESULT),
      [detailPath('dev123')]: ok(DETAIL_RESULT),
    });
    const direct = await adapter.getDeviceCapabilities('dev123');
    const wrapped = wrapWithErrorNormalization(adapter);
    assert.deepStrictEqual(await wrapped.getDeviceCapabilities('dev123'), direct);
  });

  await check('wrapWithErrorNormalization: capabilities failure "permission deny" -> AUTH_ERROR', async () => {
    const { adapter } = makeAdapter({ [specPath('dev123')]: fail(1106, 'permission deny') });
    const wrapped = wrapWithErrorNormalization(adapter);
    await assert.rejects(
      () => wrapped.getDeviceCapabilities('dev123'),
      (err) => err.appCode === 'AUTH_ERROR'
    );
  });

  await check('wrapWithErrorNormalization: capabilities failure "device is offline" -> DEVICE_OFFLINE', async () => {
    const { adapter } = makeAdapter({ [specPath('dev123')]: fail(2008, 'device is offline') });
    const wrapped = wrapWithErrorNormalization(adapter);
    await assert.rejects(
      () => wrapped.getDeviceCapabilities('dev123'),
      (err) => err.appCode === 'DEVICE_OFFLINE'
    );
  });

  await check('wrapWithErrorNormalization: capabilities failure "device not exist" -> DEVICE_NOT_FOUND', async () => {
    const { adapter } = makeAdapter({ [specPath('dev123')]: fail(2001, 'device not exist') });
    const wrapped = wrapWithErrorNormalization(adapter);
    await assert.rejects(
      () => wrapped.getDeviceCapabilities('dev123'),
      (err) => err.appCode === 'DEVICE_NOT_FOUND'
    );
  });

  await check('wrapWithErrorNormalization: unrecognized capabilities failure -> UPSTREAM_ERROR', async () => {
    const { adapter } = makeAdapter({ [specPath('dev123')]: fail(500, 'internal error') });
    const wrapped = wrapWithErrorNormalization(adapter);
    await assert.rejects(
      () => wrapped.getDeviceCapabilities('dev123'),
      (err) => err.appCode === 'UPSTREAM_ERROR'
    );
  });

  await check('wrapWithErrorNormalization: token failure during capabilities -> AUTH_ERROR', async () => {
    const http = async (baseUrl, req) => {
      if (req.path.startsWith('/v1.0/token')) return fail(1004, 'sign invalid');
      throw new Error('should not be reached');
    };
    const adapter = new TuyaAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET, httpRequest: http });
    const wrapped = wrapWithErrorNormalization(adapter);
    await assert.rejects(
      () => wrapped.getDeviceCapabilities('dev123'),
      (err) => err.appCode === 'AUTH_ERROR'
    );
  });

  // ---- no credential leakage ------------------------------------------------

  await check('errors from capabilities never contain the access secret, access token, or a signature', async () => {
    const scenarios = [
      { [specPath('dev123')]: fail(1106, 'permission deny') },
      { [specPath('dev123')]: fail(2008, 'device is offline') },
    ];
    for (const byPath of scenarios) {
      const { adapter, http } = makeAdapter(byPath);
      const wrapped = wrapWithErrorNormalization(adapter);
      let caught;
      try {
        await wrapped.getDeviceCapabilities('dev123');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, 'expected an error');
      const surfaced = JSON.stringify({ message: caught.message, code: caught.code, appCode: caught.appCode });
      assert.strictEqual(surfaced.includes(DUMMY_ACCESS_SECRET), false);
      assert.strictEqual(surfaced.includes(DUMMY_TOKEN), false);
      for (const call of http.calls) {
        if (call.headers && call.headers.sign) assert.strictEqual(surfaced.includes(call.headers.sign), false);
      }
    }
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
