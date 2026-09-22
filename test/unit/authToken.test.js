'use strict';

/**
 * Unit tests for the auth token middleware factory (Round C / F-04), in
 * isolation from Express routing. No network, no real app.
 */

const assert = require('assert');
const createAuthMiddleware = require('../../src/middleware/authToken');

function makeReq(authorization) {
  return { headers: authorization === undefined ? {} : { authorization } };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
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
  console.log('=== authToken middleware unit tests (F-04) ===\n');

  await check('token unset -> no-op middleware calls next() with no header', () => {
    const mw = createAuthMiddleware({ token: undefined });
    const req = makeReq();
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, null);
  });

  await check('token set to empty string -> also treated as unset (no-op)', () => {
    const mw = createAuthMiddleware({ token: '' });
    const req = makeReq();
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);
  });

  await check('token set, no Authorization header -> 401 UNAUTHORIZED, next() not called', () => {
    const mw = createAuthMiddleware({ token: 'secret' });
    const req = makeReq();
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    assert.strictEqual(typeof res.body.error, 'string');
  });

  await check('token set, wrong Authorization header -> 401 UNAUTHORIZED', () => {
    const mw = createAuthMiddleware({ token: 'secret' });
    const req = makeReq('Bearer wrong');
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
  });

  await check('token set, header missing the "Bearer " prefix -> 401 UNAUTHORIZED', () => {
    const mw = createAuthMiddleware({ token: 'secret' });
    const req = makeReq('secret');
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
  });

  await check('token set, correct "Bearer <token>" header -> calls next(), no response written', () => {
    const mw = createAuthMiddleware({ token: 'secret' });
    const req = makeReq('Bearer secret');
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, null);
  });

  await check('token set, correct token but wrong case in "bearer" -> 401 (exact match required)', () => {
    const mw = createAuthMiddleware({ token: 'secret' });
    const req = makeReq('bearer secret');
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
