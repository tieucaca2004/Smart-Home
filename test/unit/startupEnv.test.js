'use strict';

/**
 * Regression tests for `npm start` loading `.env` (via Node's native
 * `--env-file`, no dotenv dependency).
 *
 * The boot tests take the LITERAL arguments from package.json's "start" script
 * and run them against a THROWAWAY sandbox directory (a copy of src/ plus its
 * own `.env` in the OS temp dir). They therefore:
 *   - never read, write or overwrite a real `.env` in the project root,
 *   - use dummy credentials only, and
 *   - make no Tuya network call (the server only constructs TuyaAdapter at
 *     boot and /health does not touch Tuya).
 * Any TUYA_* / PORT variable inherited from the caller's shell is scrubbed from
 * the child's environment first, so a value can only come from the sandbox .env
 * (or from the explicit `extraEnv` a test passes on purpose).
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const DUMMY_CREDENTIALS = ['TUYA_ACCESS_ID=dummy_access_id', 'TUYA_ACCESS_SECRET=dummy_access_secret'];

/** Arguments after the leading `node` of the start script, e.g. ['--env-file=.env', 'src/server.js']. */
function startArgs() {
  const parts = String(pkg.scripts.start).trim().split(/\s+/);
  assert.strictEqual(parts[0], 'node', 'start script must begin with "node"');
  return parts.slice(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function makeSandbox(envFileContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tieu-hub-start-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  if (envFileContent !== null) fs.writeFileSync(path.join(dir, '.env'), envFileContent);
  return dir;
}

function scrubbedEnv(extra) {
  const env = Object.assign({}, process.env, { NODE_PATH: path.join(ROOT, 'node_modules') });
  for (const key of Object.keys(env)) {
    if (key.startsWith('TUYA_') || key === 'PORT') delete env[key];
  }
  return Object.assign(env, extra);
}

function getHealthStatus(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 500 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Runs the Hub with `args` inside a sandbox and reports what happened:
 * { healthy: true } once GET /health on `expectPort` answers 200, or
 * { healthy: false, exitCode, stderr } if the process exits / never comes up.
 * Always kills the child and removes the sandbox.
 */
async function runHub({ args, envFileContent, extraEnv = {}, expectPort, timeoutMs = 8000 }) {
  const dir = makeSandbox(envFileContent);
  const child = spawn(process.execPath, args, {
    cwd: dir,
    env: scrubbedEnv(extraEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let exitCode;
  let exited = false;
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code) => {
      exited = true;
      exitCode = code;
      resolve();
    });
  });

  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (exited) return { healthy: false, exitCode, stderr };
      if (expectPort !== undefined && (await getHealthStatus(expectPort)) === 200) return { healthy: true };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { healthy: false, exitCode: exited ? exitCode : 'timeout', stderr };
  } finally {
    if (!exited) child.kill();
    await exitPromise;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // best-effort cleanup of a temp dir
    }
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
  console.log('=== npm start / .env loading tests (sandboxed, dummy credentials, no Tuya network) ===\n');

  await check('start script uses Node\'s native loader: "node --env-file=.env src/server.js"', () => {
    assert.strictEqual(pkg.scripts.start, 'node --env-file=.env src/server.js');
  });

  // Why 20.7 and not 20.6: --env-file exists from Node 20.6.0, but on 20.6.0-20.6.1 the file
  // OVERRIDES real environment variables. From 20.7.0 real variables win (as Node documents),
  // which is the behavior this project relies on. Verified against those exact Node builds.
  const MIN_MAJOR = 20;
  const MIN_MINOR = 7;

  await check(`engines.node declares a floor of at least ${MIN_MAJOR}.${MIN_MINOR}`, () => {
    const m = /^>=\s*(\d+)(?:\.(\d+))?/.exec(String(pkg.engines && pkg.engines.node));
    assert.ok(m, `engines.node must start with ">=", got "${pkg.engines && pkg.engines.node}"`);
    const major = Number(m[1]);
    const minor = Number(m[2] || 0);
    assert.ok(
      major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR),
      `engines.node floor ${major}.${minor} is below ${MIN_MAJOR}.${MIN_MINOR}`
    );
  });

  await check(`the Node running this test (${process.versions.node}) meets that floor`, () => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    assert.ok(
      major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR),
      `Node ${process.versions.node} is below ${MIN_MAJOR}.${MIN_MINOR}: --env-file is missing or lets .env override real environment variables`
    );
  });

  await check('does not depend on dotenv (native loader only)', () => {
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    assert.strictEqual('dotenv' in deps, false);
  });

  await check('the start command boots the Hub with PORT and credentials taken ONLY from .env', async () => {
    const port = await freePort();
    const res = await runHub({
      args: startArgs(),
      envFileContent: [`PORT=${port}`, ...DUMMY_CREDENTIALS, ''].join('\n'),
      expectPort: port,
    });
    assert.strictEqual(res.healthy, true, `Hub did not come up: exit=${res.exitCode} stderr=${res.stderr}`);
  });

  await check('a Windows-style CRLF .env also works (PORT parsed without a stray \\r)', async () => {
    const port = await freePort();
    const res = await runHub({
      args: startArgs(),
      envFileContent: [`PORT=${port}`, ...DUMMY_CREDENTIALS, ''].join('\r\n'),
      expectPort: port,
    });
    assert.strictEqual(res.healthy, true, `Hub did not come up: exit=${res.exitCode} stderr=${res.stderr}`);
  });

  await check('a real environment variable takes precedence over the same key in .env', async () => {
    const [unusedPort, realPort] = [await freePort(), await freePort()];
    const res = await runHub({
      args: startArgs(),
      envFileContent: [`PORT=${unusedPort}`, ...DUMMY_CREDENTIALS, ''].join('\n'),
      extraEnv: { PORT: String(realPort) },
      expectPort: realPort,
    });
    assert.strictEqual(res.healthy, true, `Hub did not come up on the env-provided port: ${res.stderr}`);
  });

  await check('missing .env fails fast with a non-zero exit (no half-started server)', async () => {
    const port = await freePort();
    const res = await runHub({ args: startArgs(), envFileContent: null, extraEnv: { PORT: String(port) }, expectPort: port });
    assert.strictEqual(res.healthy, false);
    assert.ok(typeof res.exitCode === 'number' && res.exitCode !== 0, `expected a non-zero exit, got ${res.exitCode}`);
  });

  await check('control: the OLD command (plain "node src/server.js") ignores .env and dies for missing credentials', async () => {
    const port = await freePort();
    const res = await runHub({
      args: ['src/server.js'],
      envFileContent: [`PORT=${port}`, ...DUMMY_CREDENTIALS, ''].join('\n'),
      expectPort: port,
    });
    assert.strictEqual(res.healthy, false);
    assert.match(res.stderr, /Missing Tuya credentials/);
  });

  // ---- Round C / F-04: optional HUB_HOST bind (regression + positive control) ----

  await check('HUB_HOST unset: the Hub is still reachable at 127.0.0.1:<port> (regression, unchanged behavior)', async () => {
    const port = await freePort();
    const res = await runHub({
      args: startArgs(),
      envFileContent: [`PORT=${port}`, ...DUMMY_CREDENTIALS, ''].join('\n'),
      expectPort: port,
    });
    assert.strictEqual(res.healthy, true, `Hub did not come up: exit=${res.exitCode} stderr=${res.stderr}`);
  });

  await check('HUB_HOST=127.0.0.1 set: the Hub is reachable at 127.0.0.1:<port> (positive control, value is used)', async () => {
    const port = await freePort();
    const res = await runHub({
      args: startArgs(),
      envFileContent: [`PORT=${port}`, `HUB_HOST=127.0.0.1`, ...DUMMY_CREDENTIALS, ''].join('\n'),
      expectPort: port,
    });
    assert.strictEqual(res.healthy, true, `Hub did not come up: exit=${res.exitCode} stderr=${res.stderr}`);
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
