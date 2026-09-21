'use strict';

/**
 * Protocol-neutral helpers for the "delayed, bounded read-back" used by the
 * automation actions.
 *
 * Why: a device command is accepted by the cloud/bridge first and the new state
 * becomes visible to a status read a moment later (propagation delay). A single
 * immediate read-back can therefore still show the OLD value even though the
 * command worked. The actions now read immediately (fast path), and if that does
 * not confirm the value they wait once and read again - exactly once. They never
 * re-send the command. Only `[{ code, value }]` status lists are looked at here.
 */

/** Code carried by an action that was sent but whose new value was not (yet) read back. */
const UNCONFIRMED_CODE = 'UNCONFIRMED';

/** Defaults used when nobody injects options. */
const DEFAULT_VERIFY = Object.freeze({ retryDelayMs: 2000, maxTotalWaitMs: 10000 });

/** Hard limits so a bad option can never stall the scheduler for long. */
const MAX_RETRY_DELAY_MS = 5000;
const MAX_TOTAL_WAIT_MS = 15000;

const MAX_LOG_TEXT = 300;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates/clamps the engine-level `verify` option. Wrong types fall back to
 * the defaults.
 * @param {{retryDelayMs?: number, maxTotalWaitMs?: number, sleep?: Function}} [options]
 * @returns {{retryDelayMs: number, maxTotalWaitMs: number, sleep: Function}}
 */
function normalizeVerifyOptions(options) {
  const o = options && typeof options === 'object' ? options : {};
  return {
    retryDelayMs: clampNumber(o.retryDelayMs, 0, MAX_RETRY_DELAY_MS, DEFAULT_VERIFY.retryDelayMs),
    maxTotalWaitMs: clampNumber(o.maxTotalWaitMs, 0, MAX_TOTAL_WAIT_MS, DEFAULT_VERIFY.maxTotalWaitMs),
    sleep: typeof o.sleep === 'function' ? o.sleep : defaultSleep,
  };
}

/**
 * What an action uses to wait: the `ctx.verify` the engine passed (delay, sleep
 * and a per-rule wait budget), or the defaults (no budget) when an action is
 * executed directly without one.
 * @returns {{retryDelayMs: number, sleep: Function, budget: {remainingMs: number}|null}}
 */
function resolveVerify(ctx) {
  const v = ctx && ctx.verify && typeof ctx.verify === 'object' ? ctx.verify : {};
  const budget = v.budget && typeof v.budget === 'object' && Number.isFinite(v.budget.remainingMs) ? v.budget : null;
  return {
    retryDelayMs: clampNumber(v.retryDelayMs, 0, MAX_RETRY_DELAY_MS, DEFAULT_VERIFY.retryDelayMs),
    sleep: typeof v.sleep === 'function' ? v.sleep : defaultSleep,
    budget,
  };
}

/**
 * Waits one retry delay if the wait budget allows it (and charges the budget).
 * @returns {Promise<boolean>} false when the budget is exhausted (no wait, no retry).
 */
async function waitForRetry(verify) {
  const { retryDelayMs, sleep, budget } = verify;
  if (budget) {
    if (budget.remainingMs < retryDelayMs) return false;
    budget.remainingMs -= retryDelayMs;
  }
  try {
    await sleep(retryDelayMs);
  } catch (_err) {
    // A failing sleep must not turn into an action failure; just read again.
  }
  return true;
}

/** Reads a device's status once. Never throws. */
async function readStatus(deviceService, deviceId) {
  try {
    if (!deviceService || typeof deviceService.getDeviceStatus !== 'function') {
      throw new Error('no device service available for read-back');
    }
    const status = await deviceService.getDeviceStatus(deviceId);
    return { status: Array.isArray(status) ? status : [], error: null };
  } catch (err) {
    return { status: null, error: (err && err.message) || 'unknown read error' };
  }
}

/** Does this `[{code, value}]` list show `code === value`? */
function statusMatches(status, code, value) {
  if (!Array.isArray(status)) return false;
  const reported = status.find((s) => s && s.code === code);
  return Boolean(reported) && reported.value === value;
}

/**
 * Reads one device once and compares.
 * @returns {Promise<{matches: boolean|null, error: string|null}>} `matches` is
 *   `null` when the read itself failed.
 */
async function readMatches(deviceService, deviceId, code, value) {
  const { status, error } = await readStatus(deviceService, deviceId);
  if (status === null) return { matches: null, error };
  return { matches: statusMatches(status, code, value), error: null };
}

/**
 * Makes text safe for ONE log line: control characters (newlines, NUL, ...)
 * become a single space and the length is capped.
 */
function sanitizeLogText(text) {
  let clean = '';
  let inControlRun = false;
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      if (!inControlRun) clean += ' ';
      inControlRun = true;
    } else {
      clean += ch;
      inControlRun = false;
    }
  }
  return clean.length > MAX_LOG_TEXT ? `${clean.slice(0, MAX_LOG_TEXT)}...` : clean;
}

module.exports = {
  UNCONFIRMED_CODE,
  DEFAULT_VERIFY,
  defaultSleep,
  normalizeVerifyOptions,
  resolveVerify,
  waitForRetry,
  readStatus,
  statusMatches,
  readMatches,
  sanitizeLogText,
};
