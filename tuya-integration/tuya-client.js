'use strict';

/**
 * tuya-client.js
 *
 * Minimal Node.js client for the Tuya Cloud OpenAPI, built for the
 * "Phong Tieu Home" Tuya Cloud project (Data Center: Western America,
 * endpoint: https://openapi.tuyaus.com).
 *
 * Implements Tuya's "Simple Mode" HMAC-SHA256 request signing exactly as
 * described in the current official docs:
 *   https://developer.tuya.com/en/docs/iot/new-singnature?id=Kbw0q34cs2e5g
 *
 * Credentials are read ONLY from environment variables:
 *   TUYA_ACCESS_ID
 *   TUYA_ACCESS_SECRET
 *
 * The Access Secret is NEVER logged or printed.
 *
 * No external dependencies (uses Node's built-in https + crypto).
 */

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const ACCESS_ID = process.env.TUYA_ACCESS_ID;
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;
const ENDPOINT = process.env.TUYA_ENDPOINT || 'https://openapi.tuyaus.com';

if (!ACCESS_ID || !ACCESS_SECRET) {
  // Do not print the secret. Just flag that credentials are missing.
  console.error(
    '[tuya-client] Missing TUYA_ACCESS_ID and/or TUYA_ACCESS_SECRET environment variables.'
  );
}

// In-memory token cache (per process run only).
let tokenCache = {
  access_token: null,
  refresh_token: null,
  expire_at: 0, // epoch ms
};

/** SHA256 hex digest of a string (used for the Content-SHA256 part of the sign string). */
function sha256Hex(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** HMAC-SHA256 sign, uppercase hex, per Tuya spec. */
function hmacSha256Upper(str, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(str, 'utf8')
    .digest('hex')
    .toUpperCase();
}

/**
 * Build the Tuya "stringToSign" and full signature.
 *
 * @param {string} method   HTTP method, e.g. 'GET' / 'POST'
 * @param {string} pathWithQuery  e.g. '/v1.0/token?grant_type=1' (query params must
 *                 be sorted alphabetically by key if there are multiple)
 * @param {object} headers  extra headers to include in the "Headers" part of the
 *                 signature (usually empty for basic calls)
 * @param {string} body     raw request body string ('' for GET / no body)
 * @param {string|null} accessToken  pass null for the /v1.0/token call itself,
 *                 pass the current access_token for all business API calls.
 * @param {number} t        millisecond timestamp, must match the t header sent
 */
function buildSign({ method, pathWithQuery, headers = {}, body = '', accessToken, t }) {
  const contentSha256 = sha256Hex(body || '');
  const headerKeys = Object.keys(headers);
  const signHeadersStr = headerKeys.map((k) => `${k}:${headers[k]}`).join('\n');

  const stringToSign = [method, contentSha256, signHeadersStr, pathWithQuery].join('\n');

  const strToken = accessToken ? accessToken : '';
  const str = ACCESS_ID + strToken + t + stringToSign;

  const sign = hmacSha256Upper(str, ACCESS_SECRET);
  return { sign, signHeadersStr, headerKeys };
}

/**
 * Low-level HTTPS request helper.
 */
function httpsRequest({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = { raw: data };
        }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Core signed request function used by every API call below.
 *
 * @param {string} method
 * @param {string} path   e.g. '/v1.0/devices/{id}/commands' (already substituted)
 * @param {object|null} bodyObj  JSON body object, or null
 * @param {boolean} useToken  true for all calls except the token endpoint itself
 */
async function signedRequest(method, path, bodyObj, useToken) {
  if (!ACCESS_ID || !ACCESS_SECRET) {
    throw new Error(
      'TUYA_ACCESS_ID / TUYA_ACCESS_SECRET are not set in the environment. ' +
        'Set them before running any Tuya API call.'
    );
  }

  const t = Date.now();
  const body = bodyObj ? JSON.stringify(bodyObj) : '';

  let accessToken = null;
  if (useToken) {
    accessToken = await getValidAccessToken();
  }

  const { sign } = buildSign({
    method,
    pathWithQuery: path,
    headers: {},
    body,
    accessToken,
    t,
  });

  const headers = {
    client_id: ACCESS_ID,
    sign,
    t: String(t),
    sign_method: 'HMAC-SHA256',
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.access_token = accessToken;

  const url = ENDPOINT + path;
  const result = await httpsRequest({ method, url, headers, body });
  return { url, method, ...result };
}

/**
 * getToken()
 * Calls GET /v1.0/token?grant_type=1 to obtain an access_token using the
 * client credentials grant. Does NOT use an existing access_token to sign
 * this call (per Tuya spec, the token endpoint signs without a token).
 *
 * Returns { access_token, refresh_token, expire_time, uid, ... } on success,
 * or throws with the raw Tuya error payload on failure.
 */
async function getToken() {
  if (!ACCESS_ID || !ACCESS_SECRET) {
    throw new Error(
      'TUYA_ACCESS_ID / TUYA_ACCESS_SECRET are not set in the environment. ' +
        'Set them before running any Tuya API call.'
    );
  }

  const path = '/v1.0/token?grant_type=1';
  const t = Date.now();

  const { sign } = buildSign({
    method: 'GET',
    pathWithQuery: path,
    headers: {},
    body: '',
    accessToken: null,
    t,
  });

  const headers = {
    client_id: ACCESS_ID,
    sign,
    t: String(t),
    sign_method: 'HMAC-SHA256',
  };

  const url = ENDPOINT + path;
  const res = await httpsRequest({ method: 'GET', url, headers });

  if (res.body && res.body.success && res.body.result) {
    tokenCache.access_token = res.body.result.access_token;
    tokenCache.refresh_token = res.body.result.refresh_token;
    // expire_time is in seconds; refresh 60s early to be safe.
    tokenCache.expire_at = Date.now() + (res.body.result.expire_time - 60) * 1000;
  }

  return { url, method: 'GET', statusCode: res.statusCode, body: res.body };
}

/** Internal: returns a cached, still-valid access_token, fetching a new one if needed. */
async function getValidAccessToken() {
  if (tokenCache.access_token && Date.now() < tokenCache.expire_at) {
    return tokenCache.access_token;
  }
  const tokenResult = await getToken();
  if (!tokenResult.body || !tokenResult.body.success) {
    const err = new Error(
      `Failed to obtain Tuya access_token: ${JSON.stringify(tokenResult.body)}`
    );
    err.tuyaResponse = tokenResult;
    throw err;
  }
  return tokenCache.access_token;
}

/**
 * getDevices()
 * NOTE: Tuya Cloud does not expose a generic "list all devices" endpoint
 * without a uid/space id in the current API. This helper is a thin wrapper
 * around the "get devices by uid" endpoint (GET /v1.0/users/{uid}/devices),
 * kept here for completeness / future use once a uid is known. For a single
 * known device, use getDeviceInfo()/getDeviceStatus() instead.
 */
async function getDevices(uid) {
  if (!uid) {
    throw new Error('getDevices(uid) requires a Tuya user id (uid). ' +
      'Use getDeviceInfo(deviceId) if you already know the device id.');
  }
  const path = `/v1.0/users/${encodeURIComponent(uid)}/devices`;
  return signedRequest('GET', path, null, true);
}

/**
 * getDeviceInfo(deviceId)
 * GET /v1.0/devices/{device_id}
 */
async function getDeviceInfo(deviceId) {
  const path = `/v1.0/devices/${encodeURIComponent(deviceId)}`;
  return signedRequest('GET', path, null, true);
}

/**
 * getDeviceStatus(deviceId)
 * GET /v1.0/devices/{device_id}/status
 */
async function getDeviceStatus(deviceId) {
  const path = `/v1.0/devices/${encodeURIComponent(deviceId)}/status`;
  return signedRequest('GET', path, null, true);
}

/**
 * sendCommand(deviceId, code, value)
 * POST /v1.0/devices/{device_id}/commands
 * Body: { commands: [ { code, value } ] }
 */
async function sendCommand(deviceId, code, value) {
  const path = `/v1.0/devices/${encodeURIComponent(deviceId)}/commands`;
  const body = { commands: [{ code, value }] };
  return signedRequest('POST', path, body, true);
}

/** turnOn(deviceId) — convenience wrapper: sets switch_1 = true */
async function turnOn(deviceId, dpCode = 'switch_1') {
  return sendCommand(deviceId, dpCode, true);
}

/** turnOff(deviceId) — convenience wrapper: sets switch_1 = false */
async function turnOff(deviceId, dpCode = 'switch_1') {
  return sendCommand(deviceId, dpCode, false);
}

module.exports = {
  getToken,
  getDevices,
  getDeviceInfo,
  getDeviceStatus,
  sendCommand,
  turnOn,
  turnOff,
};
