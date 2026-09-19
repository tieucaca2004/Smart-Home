'use strict';

/**
 * Offline unit tests for TuyaDiscoveryAdapter — no network, no real credentials.
 * The HTTPS call is replaced with an injected fake transport that answers by
 * request path, so nothing here talks to Tuya.
 */

const assert = require('assert');
const TuyaAdapter = require('../../src/adapters/tuya/TuyaAdapter');
const TuyaDiscoveryAdapter = require('../../src/adapters/tuya/TuyaDiscoveryAdapter');

const DUMMY_ACCESS_ID = 'dummy_access_id';
const DUMMY_ACCESS_SECRET = 'dummy_access_secret';
const DISCOVERY = '/v1.0/iot-01/associated-users/devices';

const ok = (result) => ({ statusCode: 200, body: { success: true, result } });
const fail = (code, msg) => ({ statusCode: 200, body: { success: false, code, msg } });

/** A raw Tuya device as the discovery endpoint returns it, secrets included. */
function rawDevice(id, overrides = {}) {
  return Object.assign(
    {
      id,
      name: `Device ${id}`,
      category: 'kg',
      online: true,
      local_key: `LOCALKEY-${id}`,
      ip: '203.0.113.7',
      uid: 'gg-secret-user-id',
      uuid: `uuid-${id}`,
      product_name: 'Some product',
      lat: '12.3',
      lon: '109.1',
      status: [{ code: 'switch_1', value: true }],
    },
    overrides
  );
}

/**
 * A transport that answers by exact request path (query string included).
 * `routes` maps a path to a response or to a function producing one.
 */
function makeTransport(routes) {
  const calls = [];
  const transport = async (baseUrl, req) => {
    calls.push(req);
    if (req.path.startsWith('/v1.0/token')) return ok({ access_token: 'tok', expire_time: 7200 });
    const route = routes[req.path];
    if (route === undefined) throw new Error(`fake transport: unexpected path ${req.path}`);
    return typeof route === 'function' ? route(req) : route;
  };
  transport.calls = calls;
  return transport;
}

function makeAdapter(routes, options = {}) {
  const transport = makeTransport(routes);
  const adapter = new TuyaDiscoveryAdapter(
    Object.assign(
      { accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET, httpRequest: transport },
      options
    )
  );
  return { adapter, transport };
}

const discoveryCalls = (transport) => transport.calls.filter((c) => c.path.startsWith(DISCOVERY));

/** Runs fn with console.warn captured, so expected warnings do not clutter the test output. */
async function withWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await fn(warnings);
  } finally {
    console.warn = original;
  }
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
  console.log('=== TuyaDiscoveryAdapter offline unit tests (no network, no real credentials) ===\n');

  await check('is a TuyaAdapter; signing, status, capabilities and commands are inherited, not redefined', () => {
    const adapter = new TuyaDiscoveryAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET });
    assert.ok(adapter instanceof TuyaAdapter);
    assert.strictEqual(adapter.protocol, 'tuya');
    for (const method of ['_sign', '_call', 'getToken', 'getDeviceStatus', 'getDeviceCapabilities', 'sendCommand']) {
      assert.strictEqual(
        TuyaDiscoveryAdapter.prototype[method],
        TuyaAdapter.prototype[method],
        `${method} must be TuyaAdapter's own`
      );
    }
  });

  await check('lists every device discovery returns, as Hub device records', async () => {
    const { adapter } = makeAdapter({
      [`${DISCOVERY}?size=50`]: ok({
        has_more: false,
        total: 3,
        devices: [
          rawDevice('aaa', { name: 'Công tắc A', category: 'kg', online: true }),
          rawDevice('bbb', { name: 'Quạt B', category: 'fs', online: false }),
          rawDevice('ccc', { name: 'Đèn C', category: 'dj', online: true }),
        ],
      }),
    });

    const devices = await adapter.getDevices();

    assert.deepStrictEqual(devices, [
      { id: 'tuya:aaa', nativeId: 'aaa', protocol: 'tuya', name: 'Công tắc A', category: 'kg', online: true },
      { id: 'tuya:bbb', nativeId: 'bbb', protocol: 'tuya', name: 'Quạt B', category: 'fs', online: false },
      { id: 'tuya:ccc', nativeId: 'ccc', protocol: 'tuya', name: 'Đèn C', category: 'dj', online: true },
    ]);
  });

  await check('never copies secrets or private data from Tuya (local_key, ip, uid, ...)', async () => {
    const { adapter } = makeAdapter({
      [`${DISCOVERY}?size=50`]: ok({ has_more: false, devices: [rawDevice('aaa'), rawDevice('bbb')] }),
    });

    const json = JSON.stringify(await adapter.getDevices());

    for (const leaked of ['LOCALKEY', 'local_key', '203.0.113.7', 'gg-secret-user-id', 'uuid-', 'lat', 'Some product']) {
      assert.strictEqual(json.includes(leaked), false, `${leaked} leaked`);
    }
  });

  await check('discovery is a read-only GET; the first page is requested with size only', async () => {
    const { adapter, transport } = makeAdapter({
      [`${DISCOVERY}?size=50`]: ok({ has_more: false, devices: [rawDevice('aaa')] }),
    });

    await adapter.getDevices();

    const calls = discoveryCalls(transport);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].method, 'GET');
    assert.strictEqual(calls[0].path, `${DISCOVERY}?size=50`);
    assert.strictEqual(transport.calls.every((c) => c.method === 'GET'), true);
    assert.strictEqual(transport.calls.some((c) => c.path.includes('/commands')), false);
  });

  await check('follows pagination with last_row_key (URL-encoded, before size: Tuya signs the query in that order)', async () => {
    const cursor = 'a b/c=d';
    const { adapter, transport } = makeAdapter({
      [`${DISCOVERY}?size=50`]: ok({ has_more: true, last_row_key: cursor, devices: [rawDevice('aaa'), rawDevice('bbb')] }),
      [`${DISCOVERY}?last_row_key=${encodeURIComponent(cursor)}&size=50`]: ok({
        has_more: false,
        devices: [rawDevice('ccc')],
      }),
    });

    const devices = await adapter.getDevices();

    assert.deepStrictEqual(devices.map((d) => d.nativeId), ['aaa', 'bbb', 'ccc']);
    assert.strictEqual(discoveryCalls(transport).length, 2);
  });

  await check('a device repeated across pages is listed once', async () => {
    const { adapter } = makeAdapter({
      [`${DISCOVERY}?size=50`]: ok({ has_more: true, last_row_key: 'k1', devices: [rawDevice('aaa'), rawDevice('bbb')] }),
      [`${DISCOVERY}?last_row_key=k1&size=50`]: ok({ has_more: false, devices: [rawDevice('bbb'), rawDevice('ccc')] }),
    });

    const devices = await adapter.getDevices();

    assert.deepStrictEqual(devices.map((d) => d.nativeId), ['aaa', 'bbb', 'ccc']);
  });

  await check('a cursor that does not advance cannot loop forever', async () => {
    const { adapter, transport } = makeAdapter({
      [`${DISCOVERY}?size=50`]: ok({ has_more: true, last_row_key: 'k1', devices: [rawDevice('aaa')] }),
      [`${DISCOVERY}?last_row_key=k1&size=50`]: ok({ has_more: true, last_row_key: 'k1', devices: [rawDevice('bbb')] }),
    });

    const devices = await adapter.getDevices();

    assert.deepStrictEqual(devices.map((d) => d.nativeId), ['aaa', 'bbb']);
    assert.strictEqual(discoveryCalls(transport).length, 2);
  });

  await check('has_more without a last_row_key stops instead of repeating the first page', async () => {
    const { adapter, transport } = makeAdapter({
      [`${DISCOVERY}?size=50`]: ok({ has_more: true, devices: [rawDevice('aaa')] }),
    });

    const devices = await adapter.getDevices();

    assert.strictEqual(devices.length, 1);
    assert.strictEqual(discoveryCalls(transport).length, 1);
  });

  await check('offline devices are listed as offline; the older is_online field is understood', async () => {
    const { adapter } = makeAdapter({
      [`${DISCOVERY}?size=50`]: ok({
        has_more: false,
        devices: [
          rawDevice('off', { online: false }),
          rawDevice('old', { online: undefined, is_online: true }),
          rawDevice('unk', { online: undefined }),
        ],
      }),
    });

    const byId = Object.fromEntries((await adapter.getDevices()).map((d) => [d.nativeId, d]));

    assert.strictEqual(byId.off.online, false);
    assert.strictEqual(byId.old.online, true);
    assert.strictEqual('online' in byId.unk, false, 'unknown stays unknown, it is not turned into online');
  });

  await check('entries without an id are skipped; a missing name is left out, not invented', async () => {
    const { adapter } = makeAdapter({
      [`${DISCOVERY}?size=50`]: ok({
        has_more: false,
        devices: [{ name: 'no id' }, null, rawDevice('aaa', { name: undefined, category: undefined })],
      }),
    });

    const devices = await adapter.getDevices();

    assert.deepStrictEqual(devices, [{ id: 'tuya:aaa', nativeId: 'aaa', protocol: 'tuya', online: true }]);
  });

  await check('configured ids (TUYA_DEVICE_IDS) come first, keep their record, and are not duplicated', async () => {
    const { adapter } = makeAdapter(
      {
        '/v2.0/cloud/thing/aaa': ok({ name: 'From details', category: 'kg', is_online: true }),
        [`${DISCOVERY}?size=50`]: ok({
          has_more: false,
          devices: [rawDevice('bbb'), rawDevice('aaa', { name: 'From discovery' })],
        }),
      },
      { deviceIds: 'aaa' }
    );

    const devices = await adapter.getDevices();

    assert.deepStrictEqual(devices.map((d) => d.nativeId), ['aaa', 'bbb']);
    assert.strictEqual(devices[0].name, 'From details');
  });

  await check('a configured device whose lookup failed is replaced by its discovered record', async () => {
    const { adapter } = makeAdapter(
      {
        '/v2.0/cloud/thing/aaa': fail(40001900, 'No space permission'),
        [`${DISCOVERY}?size=50`]: ok({ has_more: false, devices: [rawDevice('aaa', { name: 'Found' })] }),
      },
      { deviceIds: 'aaa' }
    );

    const devices = await adapter.getDevices();

    assert.strictEqual(devices.length, 1);
    assert.strictEqual(devices[0].name, 'Found');
    assert.strictEqual('error' in devices[0], false);
  });

  await check('a configured device discovery cannot see keeps its own record, error included', async () => {
    const { adapter } = makeAdapter(
      {
        '/v2.0/cloud/thing/zzz': fail(2001, 'device not exist'),
        [`${DISCOVERY}?size=50`]: ok({ has_more: false, devices: [rawDevice('aaa')] }),
      },
      { deviceIds: 'zzz' }
    );

    const devices = await adapter.getDevices();

    assert.deepStrictEqual(devices.map((d) => d.nativeId), ['zzz', 'aaa']);
    assert.match(devices[0].error, /device not exist/);
  });

  await check('when Tuya refuses discovery the configured devices are still returned, and the reason is kept', async () => {
    await withWarnings(async (warnings) => {
      const { adapter } = makeAdapter(
        {
          '/v2.0/cloud/thing/aaa': ok({ name: 'Configured', category: 'kg', is_online: true }),
          [`${DISCOVERY}?size=50`]: fail(1106, 'permission deny'),
        },
        { deviceIds: 'aaa' }
      );

      const devices = await adapter.getDevices();

      assert.deepStrictEqual(devices.map((d) => d.nativeId), ['aaa']);
      assert.match(adapter.lastDiscoveryError, /permission deny/);
      assert.strictEqual(warnings.length, 1);
      assert.match(warnings[0], /discovery failed/);
    });
  });

  await check('a later successful discovery clears lastDiscoveryError', async () => {
    await withWarnings(async () => {
      let refuse = true;
      const { adapter } = makeAdapter({
        [`${DISCOVERY}?size=50`]: () => (refuse ? fail(1106, 'permission deny') : ok({ has_more: false, devices: [rawDevice('aaa')] })),
      });

      await adapter.getDevices();
      assert.ok(adapter.lastDiscoveryError);

      refuse = false;
      const devices = await adapter.getDevices();

      assert.strictEqual(devices.length, 1);
      assert.strictEqual(adapter.lastDiscoveryError, null);
    });
  });

  await check('discover: false behaves exactly like TuyaAdapter and never calls the discovery endpoint', async () => {
    const { adapter, transport } = makeAdapter(
      { '/v2.0/cloud/thing/aaa': ok({ name: 'Configured', category: 'kg', is_online: true }) },
      { deviceIds: 'aaa', discover: false }
    );

    const devices = await adapter.getDevices();

    assert.deepStrictEqual(devices, [
      { id: 'tuya:aaa', nativeId: 'aaa', protocol: 'tuya', name: 'Configured', category: 'kg', online: true },
    ]);
    assert.strictEqual(discoveryCalls(transport).length, 0);
  });

  await check('TUYA_DISCOVERY=off / false / 0 turns discovery off; anything else leaves it on', () => {
    const saved = process.env.TUYA_DISCOVERY;
    try {
      const enabledWith = (value) => {
        if (value === undefined) delete process.env.TUYA_DISCOVERY;
        else process.env.TUYA_DISCOVERY = value;
        return new TuyaDiscoveryAdapter({ accessId: DUMMY_ACCESS_ID, accessSecret: DUMMY_ACCESS_SECRET }).discoveryEnabled;
      };
      assert.strictEqual(enabledWith(undefined), true);
      assert.strictEqual(enabledWith(''), true);
      assert.strictEqual(enabledWith('on'), true);
      assert.strictEqual(enabledWith('off'), false);
      assert.strictEqual(enabledWith('OFF'), false);
      assert.strictEqual(enabledWith('false'), false);
      assert.strictEqual(enabledWith('0'), false);
    } finally {
      if (saved === undefined) delete process.env.TUYA_DISCOVERY;
      else process.env.TUYA_DISCOVERY = saved;
    }
  });

  await check('an empty project (no devices, none configured) lists nothing', async () => {
    const { adapter } = makeAdapter({ [`${DISCOVERY}?size=50`]: ok({ has_more: false, total: 0, devices: [] }) });

    assert.deepStrictEqual(await adapter.getDevices(), []);
  });

  await check('a discovery response with no result is treated as no devices, not as an error', async () => {
    const { adapter } = makeAdapter({ [`${DISCOVERY}?size=50`]: ok(undefined) });

    assert.deepStrictEqual(await adapter.getDevices(), []);
    assert.strictEqual(adapter.lastDiscoveryError, null);
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
