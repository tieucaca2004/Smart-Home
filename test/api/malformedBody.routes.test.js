'use strict';

/**
 * API tests (Round A / F-03): a malformed JSON body answers 400 INVALID_JSON and
 * an oversized body answers 413 PAYLOAD_TOO_LARGE, both with a fixed, safe
 * body (only `error` + `code`; no parser message, stack, path or echo of the
 * request). Valid requests and other error paths behave as before.
 *
 * In-process server on 127.0.0.1 with a fake adapter: no real Tuya network
 * calls, no real credentials, no real devices, no data files touched.
 */

const http = require('http');
const assert = require('assert');
const createApp = require('../../src/app');
const AdapterRegistry = require('../../src/adapters/AdapterRegistry');
const DeviceService = require('../../src/services/deviceService');
const { withDeviceTimeout } = require('../../src/adapters/withDeviceTimeout');

const FAKE_ID = 'fake:dev1';

const fakeAdapter = {
  get protocol() {
    return 'fake';
  },
  async getDevices() {
    return [{ id: FAKE_ID, nativeId: 'dev1', protocol: 'fake', name: 'Fake', online: true }];
  },
  async getDeviceStatus(nativeId) {
    if (nativeId === 'hung') return new Promise(() => {});
    return [{ code: 'sw', value: false }];
  },
  async sendCommand() {
    return true;
  },
};

function buildApp(adapter = fakeAdapter) {
  const registry = new AdapterRegistry();
  registry.register(adapter);
  return createApp(new DeviceService(registry));
}

/**
 * Sends a raw request and resolves `{statusCode, headers, raw, body}`.
 * `body` may be a string (sent with Content-Length) or {chunks: [...]} for a
 * chunked upload. A large body can make the server answer before the upload is
 * finished (EPIPE/ECONNRESET on the client): if a response was received, that
 * is the result and the write error is ignored.
 */
function rawRequest(server, method, urlPath, { body, contentType = 'application/json', chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    let response = null;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const headers = { Connection: 'close' };
    if (body !== undefined) headers['Content-Type'] = contentType;
    if (body !== undefined && !chunked) headers['Content-Length'] = Buffer.byteLength(body);
    if (chunked) headers['Transfer-Encoding'] = 'chunked';

    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: urlPath, headers }, (res) => {
      response = res;
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch (err) {
          // leave json = null
        }
        finish(resolve, { statusCode: res.statusCode, headers: res.headers, raw, body: json });
      });
      res.on('error', (err) => finish(reject, err));
    });
    req.on('error', (err) => {
      if (!response) finish(reject, err);
    });
    req.setTimeout(5000, () => req.destroy(new Error('test request timed out')));
    if (body !== undefined) {
      if (chunked) {
        const size = Math.ceil(body.length / 8);
        for (let i = 0; i < body.length; i += size) req.write(body.slice(i, i + size));
      } else {
        req.write(body);
      }
    }
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

const MALFORMED = '{"code":';
const BIG_TEXT = 'x'.repeat(200 * 1024);
const OVERSIZED = JSON.stringify({ code: 'sw', value: BIG_TEXT });
const NEAR_LIMIT = JSON.stringify({ code: 'sw', value: 'y'.repeat(90 * 1024) });

/** The fixed body must carry only `error` + `code` and no internal detail or request echo. */
function assertSafeBody(res, expectedCode, echoed = []) {
  assert.ok(/application\/json/.test(res.headers['content-type'] || ''), 'JSON content type');
  assert.deepStrictEqual(Object.keys(res.body).sort(), ['code', 'error']);
  assert.strictEqual(res.body.code, expectedCode);
  const text = JSON.stringify(res.body);
  const forbidden = [
    'SyntaxError', 'Unexpected', 'JSON.parse', 'Expected property', 'position', 'at ', 'node_modules',
    'body-parser', 'src', 'express', process.cwd(), '\\', '/',
  ].concat(echoed);
  for (const bad of forbidden) {
    assert.ok(!text.includes(bad), `error body must not contain "${bad}": ${text}`);
  }
}

async function run() {
  console.log('=== Malformed / oversized body API tests (F-03, no real Tuya calls) ===\n');

  const server = buildApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    for (const route of [`/api/devices/${FAKE_ID}/commands`, '/api/scenes', '/api/automations']) {
      await check(`POST ${route} with malformed JSON -> 400 INVALID_JSON`, async () => {
        const res = await rawRequest(server, 'POST', route, { body: MALFORMED });
        assert.strictEqual(res.statusCode, 400);
        assert.deepStrictEqual(res.body, { error: 'Request body is not valid JSON', code: 'INVALID_JSON' });
        assertSafeBody(res, 'INVALID_JSON');
      });
    }

    await check('malformed JSON sent chunked (no Content-Length) -> 400 INVALID_JSON', async () => {
      const res = await rawRequest(server, 'POST', `/api/devices/${FAKE_ID}/commands`, { body: '{"code": "sw", "value": tru', chunked: true });
      assert.strictEqual(res.statusCode, 400);
      assertSafeBody(res, 'INVALID_JSON');
    });

    await check('other malformed shapes (trailing garbage, bare word, single quotes) -> 400 INVALID_JSON', async () => {
      for (const bad of ["{'code':'sw'}", '{"code":"sw"} trailing', 'not json at all', '{"a":1,}']) {
        const res = await rawRequest(server, 'POST', '/api/scenes', { body: bad });
        assert.strictEqual(res.statusCode, 400, `body ${bad}`);
        assertSafeBody(res, 'INVALID_JSON', [bad]);
      }
    });

    for (const route of [`/api/devices/${FAKE_ID}/commands`, '/api/scenes', '/api/automations']) {
      await check(`POST ${route} with a ~200 KB body -> 413 PAYLOAD_TOO_LARGE`, async () => {
        const res = await rawRequest(server, 'POST', route, { body: OVERSIZED });
        assert.strictEqual(res.statusCode, 413);
        assert.deepStrictEqual(res.body, { error: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' });
        assertSafeBody(res, 'PAYLOAD_TOO_LARGE', [BIG_TEXT.slice(0, 50)]);
      });
    }

    await check('a ~200 KB body sent chunked (no Content-Length) -> 413 PAYLOAD_TOO_LARGE', async () => {
      const res = await rawRequest(server, 'POST', `/api/devices/${FAKE_ID}/commands`, { body: OVERSIZED, chunked: true });
      assert.strictEqual(res.statusCode, 413);
      assertSafeBody(res, 'PAYLOAD_TOO_LARGE', [BIG_TEXT.slice(0, 50)]);
    });

    await check('the server keeps working after rejecting bad bodies', async () => {
      const res = await rawRequest(server, 'GET', '/health');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, { status: 'ok' });
    });

    // ------------------------------------------------ valid requests unchanged
    await check('valid JSON command -> 200 as before', async () => {
      const res = await rawRequest(server, 'POST', `/api/devices/${FAKE_ID}/commands`, {
        body: JSON.stringify({ code: 'sw', value: true }),
      });
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, { id: FAKE_ID, code: 'sw', value: true, result: true });
    });

    await check('valid JSON scene -> 201 as before', async () => {
      const res = await rawRequest(server, 'POST', '/api/scenes', {
        body: JSON.stringify({ name: 'S', actions: [{ deviceId: FAKE_ID, functionCode: 'sw', value: true }] }),
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.scene.name, 'S');
    });

    await check('a body just under the 100 KB limit (~90 KB) is still accepted', async () => {
      const res = await rawRequest(server, 'POST', `/api/devices/${FAKE_ID}/commands`, { body: NEAR_LIMIT });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.code, 'sw');
    });

    await check('text/plain body keeps the old behaviour (ignored by the JSON parser -> INVALID_COMMAND 400)', async () => {
      const res = await rawRequest(server, 'POST', `/api/devices/${FAKE_ID}/commands`, { body: '{"code":', contentType: 'text/plain' });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'INVALID_COMMAND');
    });

    await check('a request without a body keeps the old behaviour (INVALID_COMMAND 400)', async () => {
      const res = await rawRequest(server, 'POST', `/api/devices/${FAKE_ID}/commands`);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'INVALID_COMMAND');
    });

    await check('business-level errors are untouched (validation 400, unknown route 404)', async () => {
      const bad = await rawRequest(server, 'POST', '/api/scenes', { body: JSON.stringify({ name: '', actions: [] }) });
      assert.strictEqual(bad.statusCode, 400);
      assert.strictEqual(bad.body.code, 'VALIDATION_ERROR');
      const missing = await rawRequest(server, 'GET', '/nope');
      assert.strictEqual(missing.statusCode, 404);
      assert.deepStrictEqual(missing.body, { error: 'Not found' });
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // A non-body 500 still goes through the old generic behaviour.
  await check('an error that is not a body-parser error keeps the old 500 handling', async () => {
    const failing = {
      get protocol() { return 'fake'; },
      async getDevices() { throw new Error('upstream exploded'); },
      async getDeviceStatus() { return []; },
      async sendCommand() { return true; },
    };
    const srv = buildApp(failing).listen(0, '127.0.0.1');
    await new Promise((resolve) => srv.once('listening', resolve));
    try {
      const res = await rawRequest(srv, 'GET', '/api/devices');
      assert.strictEqual(res.statusCode, 500);
      assert.deepStrictEqual(res.body, { error: 'upstream exploded' });
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  // F-01 through the untouched REST route: a hung device answers 502 DEVICE_TIMEOUT.
  await check('REST: a hung device call answers 502 DEVICE_TIMEOUT (via withDeviceTimeout, existing route mapping)', async () => {
    const silent = { warn: () => {} };
    const srv = buildApp(withDeviceTimeout(fakeAdapter, { timeoutMs: 40, log: silent })).listen(0, '127.0.0.1');
    await new Promise((resolve) => srv.once('listening', resolve));
    try {
      const res = await rawRequest(srv, 'GET', '/api/devices/fake:hung/status');
      assert.strictEqual(res.statusCode, 502);
      assert.strictEqual(res.body.code, 'DEVICE_TIMEOUT');
      assert.ok(!/undefined/.test(res.raw));
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
