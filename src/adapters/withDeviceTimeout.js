'use strict';

/**
 * Protocol-neutral decorator that puts a deadline on every device call an
 * adapter makes (getDevices / getDeviceStatus / getDeviceCapabilities /
 * sendCommand), so one hung call can never block its caller forever — most
 * importantly the AutomationScheduler, whose `_running` flag is only released
 * once every awaited call has settled.
 *
 * It is a pure wrapper: the adapter it wraps is never modified. It only knows
 * the DeviceAdapter contract (a `protocol` string plus those four methods) and
 * nothing about any particular protocol or vendor.
 *
 * Behaviour:
 *   - A call that settles in time returns / throws exactly what the adapter
 *     did (same value, same error object; nothing is added or re-labelled).
 *   - A call that does not settle within its deadline is abandoned and
 *     rejected with a DeviceTimeoutError whose `code` and `appCode` are both
 *     'DEVICE_TIMEOUT'. The message is a fixed safe text (no device ids,
 *     paths, URLs or secrets).
 *   - A timed-out command is NEVER re-sent: there is no retry or back-off.
 *     The device may in fact have applied it; the error message says so.
 *
 * Known limit: the deadline is a Promise.race, so it does not cancel whatever
 * the wrapped adapter has in flight (e.g. an open socket); that orphaned work
 * ends whenever the adapter's own transport gives up. Its late result or
 * rejection is ignored (Promise.race has already attached a handler to it).
 */

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIST_TIMEOUT_MS = 30000;

const TIMEOUT_MS_BOUNDS = { min: 1000, max: 60000 };
const LIST_TIMEOUT_MS_BOUNDS = { min: 1000, max: 120000 };

const TIMEOUT_CODE = 'DEVICE_TIMEOUT';

function positiveOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function makeTimeoutError(method, timeoutMs) {
  let message = `Device call timed out after ${timeoutMs} ms (${method})`;
  if (method === 'sendCommand') {
    message += '; the command may still have been applied and was not resent';
  }
  const err = new Error(message);
  err.name = 'DeviceTimeoutError';
  err.code = TIMEOUT_CODE;
  err.appCode = TIMEOUT_CODE;
  err.method = method;
  err.timeoutMs = timeoutMs;
  return err;
}

/**
 * @param {import('./DeviceAdapter')} adapter Any adapter following the DeviceAdapter contract.
 * @param {{timeoutMs?: number, listTimeoutMs?: number, log?: {warn: Function}}} [options]
 *   `timeoutMs` applies to status / capabilities / command calls, `listTimeoutMs`
 *   to getDevices (which may make several upstream calls). Values that are not
 *   finite positive numbers fall back to the defaults.
 */
function withDeviceTimeout(adapter, options = {}) {
  const timeoutMs = positiveOr(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const listTimeoutMs = positiveOr(options.listTimeoutMs, DEFAULT_LIST_TIMEOUT_MS);
  const log = options.log || console;

  async function callWithDeadline(method, ms, args) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        log.warn(
          `[device-timeout] ${method} timed out after ${ms} ms (protocol "${adapter.protocol}"); ` +
            'the call was abandoned, not retried'
        );
        reject(makeTimeoutError(method, ms));
      }, ms);
    });
    try {
      // adapter[method](...) keeps `this`; a synchronous throw becomes a rejection.
      return await Promise.race([Promise.resolve().then(() => adapter[method](...args)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  const wrapper = {
    get protocol() {
      return adapter.protocol;
    },
    timeoutMs,
    listTimeoutMs,
    getDevices: (...args) => callWithDeadline('getDevices', listTimeoutMs, args),
    getDeviceStatus: (...args) => callWithDeadline('getDeviceStatus', timeoutMs, args),
    sendCommand: (...args) => callWithDeadline('sendCommand', timeoutMs, args),
  };

  // DeviceService checks `typeof adapter.getDeviceCapabilities === 'function'`,
  // so only expose it when the wrapped adapter has it.
  if (typeof adapter.getDeviceCapabilities === 'function') {
    wrapper.getDeviceCapabilities = (...args) => callWithDeadline('getDeviceCapabilities', timeoutMs, args);
  }

  return wrapper;
}

/**
 * Reads one timeout setting from the environment: unset / empty -> default
 * (silently); not a finite number > 0 -> default plus a warning; otherwise
 * clamped into [min, max].
 */
function readOne(env, log, name, fallback, bounds) {
  const raw = typeof env[name] === 'string' ? env[name].trim() : '';
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    log.warn(`[hub] ${name} is not a positive number; using the default of ${fallback} ms.`);
    return fallback;
  }
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * Reads `HUB_DEVICE_TIMEOUT_MS` and `HUB_DEVICE_LIST_TIMEOUT_MS` (milliseconds).
 * Never throws, and there is no way to switch the timeout off.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Console} [log]
 * @returns {{timeoutMs: number, listTimeoutMs: number}}
 */
function readDeviceTimeoutOptions(env = process.env, log = console) {
  return {
    timeoutMs: readOne(env, log, 'HUB_DEVICE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, TIMEOUT_MS_BOUNDS),
    listTimeoutMs: readOne(env, log, 'HUB_DEVICE_LIST_TIMEOUT_MS', DEFAULT_LIST_TIMEOUT_MS, LIST_TIMEOUT_MS_BOUNDS),
  };
}

module.exports = {
  withDeviceTimeout,
  readDeviceTimeoutOptions,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LIST_TIMEOUT_MS,
  TIMEOUT_CODE,
};
