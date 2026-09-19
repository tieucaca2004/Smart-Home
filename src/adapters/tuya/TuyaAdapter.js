'use strict';

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const DeviceAdapter = require('../DeviceAdapter');
const { normalizeTuyaSpecification } = require('./normalizeTuyaCapabilities');

const DEFAULT_BASE_URL = 'https://openapi.tuyaus.com';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input || '', 'utf8').digest('hex');
}

function hmacSha256Hex(input, secret) {
  return crypto.createHmac('sha256', secret).update(input, 'utf8').digest('hex').toUpperCase();
}

/** Zero-dependency HTTPS JSON request helper (same approach as the verified tuya-package client). */
function httpRequest(baseUrl, { method, path, body, headers }) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const payload = body ? JSON.stringify(body) : '';

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        payload ? { 'Content-Length': Buffer.byteLength(payload) } : {},
        headers
      ),
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        let json;
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch (err) {
          reject(new Error(`Invalid JSON response (status ${res.statusCode}): ${raw.slice(0, 500)}`));
          return;
        }
        resolve({ statusCode: res.statusCode, body: json });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Tuya Cloud OpenAPI adapter.
 *
 * The signing algorithm and endpoints implemented here follow the same
 * design already LIVE-TESTED end-to-end (status read, ON, status read, OFF,
 * status read, all verified against real device state) in the separate,
 * frozen `tuya-package` project at D:\tuya-client\tuya-package — that
 * project's baseline device is Đèn Quán Quầy (1638018234ab950e1ecd),
 * Model W-W603, in Cloud project "Phong Tieu Home".
 *
 * This file is an independent implementation written for tieu-home-hub. It
 * does NOT import, require, or modify anything inside tuya-package — that
 * project stays exactly as it is.
 *
 * Credentials are never hard-coded: they come from TUYA_ACCESS_ID /
 * TUYA_ACCESS_SECRET (env vars, or explicit constructor options for tests).
 */
class TuyaAdapter extends DeviceAdapter {
  /**
   * @param {Object} [options]
   * @param {string} [options.accessId] Overrides TUYA_ACCESS_ID env var.
   * @param {string} [options.accessSecret] Overrides TUYA_ACCESS_SECRET env var.
   * @param {string} [options.baseUrl] Overrides TUYA_ENDPOINT env var.
   * @param {string} [options.deviceIds] Overrides TUYA_DEVICE_IDS env var (comma-separated).
   * @param {Function} [options.httpRequest] Test seam — injected in place of the real https call.
   */
  constructor(options = {}) {
    super();
    this.accessId = options.accessId || process.env.TUYA_ACCESS_ID;
    this.accessSecret = options.accessSecret || process.env.TUYA_ACCESS_SECRET;
    this.baseUrl = options.baseUrl || process.env.TUYA_ENDPOINT || DEFAULT_BASE_URL;

    const deviceIdsRaw = options.deviceIds !== undefined ? options.deviceIds : process.env.TUYA_DEVICE_IDS || '';
    this.knownDeviceIds = deviceIdsRaw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (!this.accessId || !this.accessSecret) {
      throw new Error(
        'Missing Tuya credentials: set TUYA_ACCESS_ID and TUYA_ACCESS_SECRET environment variables ' +
          '(never hard-code the Access Secret in source code).'
      );
    }

    this._httpRequest = options.httpRequest || httpRequest;
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  get protocol() {
    return 'tuya';
  }

  /** Same HMAC-SHA256 sign method (2.0) as the verified tuya-package client. */
  _sign(method, path, body, accessToken) {
    const t = Date.now().toString();
    const nonce = '';
    const contentHash = sha256Hex(body ? JSON.stringify(body) : '');
    const stringToSign = [method, contentHash, '', path].join('\n');
    const signStr = this.accessId + (accessToken || '') + t + nonce + stringToSign;
    const sign = hmacSha256Hex(signStr, this.accessSecret);
    return { t, nonce, sign };
  }

  async getToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this._token && now < this._tokenExpiresAt - 60 * 1000) {
      return this._token;
    }

    const method = 'GET';
    const path = '/v1.0/token?grant_type=1';
    const { t, sign } = this._sign(method, path, null, null);

    const res = await this._httpRequest(this.baseUrl, {
      method,
      path,
      headers: { client_id: this.accessId, sign_method: 'HMAC-SHA256', t, sign },
    });

    if (!res.body || res.body.success !== true) {
      const err = new Error(
        `getToken failed: code=${res.body && res.body.code} msg=${res.body && res.body.msg}`
      );
      err.response = res.body;
      throw err;
    }

    this._token = res.body.result.access_token;
    this._tokenExpiresAt = now + res.body.result.expire_time * 1000;
    return this._token;
  }

  async _call(method, path, body) {
    const token = await this.getToken();
    const { t, sign } = this._sign(method, path, body, token);

    const res = await this._httpRequest(this.baseUrl, {
      method,
      path,
      body,
      headers: {
        client_id: this.accessId,
        access_token: token,
        sign_method: 'HMAC-SHA256',
        t,
        sign,
      },
    });

    if (!res.body || res.body.success !== true) {
      const err = new Error(
        `Tuya API error on ${method} ${path}: code=${res.body && res.body.code} msg=${
          res.body && res.body.msg
        }`
      );
      err.code = res.body && res.body.code;
      err.response = res.body;
      throw err;
    }

    return res.body.result;
  }

  /**
   * v1 scope decision (documented, not an oversight): Tuya's "list all
   * devices" endpoints require a linked App-account uid or space id — and
   * a mismatch in exactly that area (space binding) was the root cause of
   * the original "No space permission" / "permission deny" errors this
   * project debugged. Calling such a listing endpoint here has NOT been
   * live-tested, so getDevices() deliberately avoids it for now.
   *
   * Instead, it builds the list from TUYA_DEVICE_IDS (comma-separated
   * device ids configured in .env) and fetches each device's details via
   * "Query Device Details" (GET /v2.0/cloud/thing/{id}) — the same call
   * already exercised successfully against real devices in this project.
   *
   * Dynamic discovery is a legitimate future improvement, tracked in the
   * README's "Known limitations" section rather than implemented here.
   */
  async getDevices() {
    const devices = await Promise.all(
      this.knownDeviceIds.map(async (nativeId) => {
        try {
          const detail = await this._call('GET', `/v2.0/cloud/thing/${nativeId}`);
          return {
            id: `${this.protocol}:${nativeId}`,
            nativeId,
            protocol: this.protocol,
            name: detail && detail.name,
            category: detail && detail.category,
            online: detail && detail.is_online,
          };
        } catch (err) {
          return {
            id: `${this.protocol}:${nativeId}`,
            nativeId,
            protocol: this.protocol,
            error: err.message,
          };
        }
      })
    );
    return devices;
  }

  /** GET /v1.0/iot-03/devices/{device_id}/status — verified live against the baseline device. */
  async getDeviceStatus(nativeId) {
    return this._call('GET', `/v1.0/iot-03/devices/${nativeId}/status`);
  }

  /**
   * Reports what the device can do, as returned by Tuya — nothing is invented.
   *
   * Read-only (two GETs; never a command):
   *   1. GET /v1.0/iot-03/devices/{device_id}/specification — Tuya's "Get the
   *      specifications and properties of the device": `category`, `functions`
   *      (instructions the device accepts) and `status` (data points it reports).
   *      Same /v1.0/iot-03/devices/{id}/… family as the verified status/commands
   *      calls, but this endpoint itself has NOT been live-tested in this
   *      project yet (see README "Known limitations").
   *   2. GET /v2.0/cloud/thing/{device_id} — the already-verified "Query Device
   *      Details" call, used only to enrich the result with name / online.
   *      Best-effort: if it fails, those optional fields are simply omitted.
   *
   * A failure of call 1 propagates unchanged (Tuya's `.code` preserved), so the
   * error normalizer can classify it. The native id is URL-encoded so an id can
   * never alter the request path.
   */
  async getDeviceCapabilities(nativeId) {
    if (!nativeId) throw new Error('getDeviceCapabilities: nativeId is required');
    const encodedId = encodeURIComponent(nativeId);

    const spec = normalizeTuyaSpecification(
      await this._call('GET', `/v1.0/iot-03/devices/${encodedId}/specification`)
    );

    let detail = null;
    try {
      detail = await this._call('GET', `/v2.0/cloud/thing/${encodedId}`);
    } catch (err) {
      detail = null; // enrichment only — capabilities are still valid without name/online
    }

    const capabilities = { nativeId, protocol: this.protocol };
    if (detail && typeof detail.name === 'string' && detail.name) capabilities.name = detail.name;
    const category = spec.category || (detail && detail.category);
    if (typeof category === 'string' && category) capabilities.category = category;
    if (detail && typeof detail.is_online === 'boolean') capabilities.online = detail.is_online;
    capabilities.commands = spec.commands;
    capabilities.statuses = spec.statuses;
    return capabilities;
  }

  /**
   * POST /v1.0/iot-03/devices/{device_id}/commands — verified live against
   * the baseline device (ON then OFF, both confirmed by re-reading status).
   */
  async sendCommand(nativeId, code, value) {
    if (!nativeId) throw new Error('sendCommand: nativeId is required');
    if (!code) throw new Error('sendCommand: code is required');
    return this._call('POST', `/v1.0/iot-03/devices/${nativeId}/commands`, {
      commands: [{ code, value }],
    });
  }
}

module.exports = TuyaAdapter;
