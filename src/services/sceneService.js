'use strict';

const { randomUUID } = require('crypto');
const {
  normalizeVerifyOptions,
  waitForRetry,
  readStatus,
  statusMatches,
  UNCONFIRMED_CODE,
} = require('../automation/readBack');

/** Scene icon keys the Flutter app knows how to draw. Purely presentational. */
const SCENE_ICONS = ['power-on', 'power-off', 'sun', 'moon', 'home', 'custom'];

function validationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

function notFoundError(id) {
  const err = new Error(`Scene "${id}" not found`);
  err.code = 'SCENE_NOT_FOUND';
  return err;
}

/**
 * Checks the shape of one action: `{ deviceId, functionCode, value }`, value
 * restricted to boolean for the MVP (see DeviceAdapter — a command's `value`
 * can be any type, but the app only offers on/off controls today, per
 * ControlKind.toggle on the Flutter side). Never looks at what the device
 * actually supports — that is checked for real at execute time, against
 * whatever adapter is registered, so this file has no protocol knowledge.
 */
function stepStatus(step) {
  if (step.success === true) return 'success';
  return step.code === UNCONFIRMED_CODE ? 'pending' : 'failed';
}

/** Scene-level status: failed > pending > success. */
function sceneStatus(results) {
  if (results.some((r) => r.status === 'failed')) return 'failed';
  if (results.some((r) => r.status === 'pending')) return 'pending';
  return 'success';
}

function validateAction(action, index) {
  if (!action || typeof action !== 'object') {
    throw validationError(`actions[${index}] must be an object`);
  }
  const { deviceId, functionCode, value } = action;
  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    throw validationError(`actions[${index}].deviceId must be a non-empty string`);
  }
  if (typeof functionCode !== 'string' || functionCode.trim() === '') {
    throw validationError(`actions[${index}].functionCode must be a non-empty string`);
  }
  if (typeof value !== 'boolean') {
    throw validationError(`actions[${index}].value must be a boolean (MVP supports Boolean commands only)`);
  }
  return { deviceId, functionCode, value };
}

function validateScenePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw validationError('Scene payload must be an object');
  }
  const { name, icon, actions } = payload;
  if (typeof name !== 'string' || name.trim() === '') {
    throw validationError('"name" must be a non-empty string');
  }
  if (icon !== undefined && icon !== null && !SCENE_ICONS.includes(icon)) {
    throw validationError(`"icon" must be one of: ${SCENE_ICONS.join(', ')}`);
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    throw validationError('"actions" must be a non-empty array');
  }
  return {
    name: name.trim(),
    icon: icon || 'custom',
    actions: actions.map(validateAction),
  };
}

/**
 * CRUD + execution for scenes: a saved, ordered list of `{deviceId,
 * functionCode, value}` actions run together under one name/icon.
 *
 * Never hard-codes a device, a category or a command code — every action is
 * whatever the caller (ultimately: the Flutter editor, built from a real
 * device's real capabilities) put in. Execution goes through the same
 * `DeviceService` the REST API already uses, so a scene works with any
 * protocol adapter, not just Tuya.
 */
class SceneService {
  /**
   * @param {import('../storage/JsonFileStore')} store
   * @param {import('./deviceService')} deviceService
   * @param {{readBack?: {retryDelayMs?: number, sleep?: Function}}} [options]
   *   `readBack` (opt-in): when given, a step whose immediate read-back is
   *   stale is re-read once after one shared delay (see `_reverifyPending`).
   *   Omitted -> immediate read-back only (the original behaviour).
   */
  constructor(store, deviceService, options = {}) {
    this.store = store;
    this.deviceService = deviceService;
    const readBack = options && options.readBack;
    this.readBack = readBack && typeof readBack === 'object' ? normalizeVerifyOptions(readBack) : null;
  }

  async listScenes() {
    return this.store.all();
  }

  async getScene(id) {
    const scene = await this.store.find(id);
    if (!scene) throw notFoundError(id);
    return scene;
  }

  async createScene(payload) {
    const clean = validateScenePayload(payload);
    const now = new Date().toISOString();
    const scene = { id: randomUUID(), ...clean, createdAt: now, updatedAt: now };
    return this.store.insert(scene);
  }

  async updateScene(id, payload) {
    const clean = validateScenePayload(payload);
    const now = new Date().toISOString();
    const updated = await this.store.update(id, (current) => ({
      ...current,
      ...clean,
      updatedAt: now,
    }));
    if (!updated) throw notFoundError(id);
    return updated;
  }

  async deleteScene(id) {
    const removed = await this.store.remove(id);
    if (!removed) throw notFoundError(id);
  }

  /**
   * Runs every action in order, one at a time, against the real device
   * service. Never assumes success from a command completing: after each
   * accepted command it reads the device's status back and only counts the
   * action as successful if the device now reports the requested value —
   * the same "don't trust the request, trust the read-back" rule the
   * Flutter DeviceControlController applies, reimplemented here because the
   * backend has no access to that Dart code.
   *
   * One action failing (rejected command, offline device, unconfirmed
   * value, unknown device...) never stops the rest: every action in the
   * scene is attempted, and the per-action outcome says exactly what
   * happened. The scene is reported successful only if every action was.
   *
   * The immediate read-back can still show the OLD value because a command
   * takes a moment to propagate. When `options.readBack` is enabled, the
   * unconfirmed steps are therefore re-read once after one shared delay
   * (never re-sent). Steps and the scene also carry an additive `status`:
   * success | pending (still UNCONFIRMED, not a failure) | failed
   * (failed > pending > success at scene level).
   */
  async executeScene(id) {
    const scene = await this.getScene(id);
    const results = [];
    for (const action of scene.actions) {
      results.push(this._withStatus(await this._runAction(action)));
    }
    const verifiedAfterRetry = this.readBack ? await this._reverifyPending(results) : false;
    const result = {
      sceneId: scene.id,
      sceneName: scene.name,
      success: results.every((r) => r.success),
      status: sceneStatus(results),
      results,
    };
    if (verifiedAfterRetry) result.verifiedAfterRetry = true;
    return result;
  }

  /** Adds the additive `status` field: success | pending (UNCONFIRMED) | failed. */
  _withStatus(step) {
    return { ...step, status: stepStatus(step) };
  }

  /**
   * One shared wait, then ONE more status read per distinct device, for the
   * steps whose immediate read-back did not show the new value (propagation
   * delay). Never re-sends a command. A step that now matches becomes a
   * success (`verifiedAfterRetry`); one that still does not (or whose read
   * fails) stays pending / UNCONFIRMED - not a failure. Mutates `results`.
   * @returns {Promise<boolean>} true when at least one step was confirmed here.
   */
  async _reverifyPending(results) {
    const pending = results.filter((r) => r.status === 'pending');
    if (pending.length === 0) return false;

    await waitForRetry({
      retryDelayMs: this.readBack.retryDelayMs,
      sleep: this.readBack.sleep,
      budget: null,
    });

    const reads = new Map();
    for (const step of pending) {
      if (!reads.has(step.deviceId)) {
        reads.set(step.deviceId, await readStatus(this.deviceService, step.deviceId));
      }
    }

    let confirmed = false;
    for (const step of pending) {
      const { status } = reads.get(step.deviceId);
      if (status !== null && statusMatches(status, step.functionCode, step.value)) {
        step.success = true;
        step.status = 'success';
        step.verifiedAfterRetry = true;
        delete step.error;
        delete step.code;
        confirmed = true;
      }
    }
    return confirmed;
  }

  async _runAction(action) {
    const { deviceId, functionCode, value } = action;
    try {
      await this.deviceService.sendCommand(deviceId, functionCode, value);
    } catch (err) {
      return {
        deviceId,
        functionCode,
        value,
        success: false,
        error: err.message,
        code: err.appCode || err.code || 'UPSTREAM_ERROR',
      };
    }
    return this._confirm(deviceId, functionCode, value);
  }

  /** One status read-back after a command the Hub accepted. */
  async _confirm(deviceId, functionCode, value) {
    let status;
    try {
      status = await this.deviceService.getDeviceStatus(deviceId);
    } catch (err) {
      return {
        deviceId,
        functionCode,
        value,
        success: false,
        error: `Command sent, but status could not be read back: ${err.message}`,
        code: 'UNCONFIRMED',
      };
    }
    const reported = Array.isArray(status) ? status.find((s) => s.code === functionCode) : undefined;
    if (reported && reported.value === value) {
      return { deviceId, functionCode, value, success: true };
    }
    return {
      deviceId,
      functionCode,
      value,
      success: false,
      error: 'Command sent, but the device did not confirm the new value',
      code: 'UNCONFIRMED',
    };
  }
}

module.exports = SceneService;
module.exports.SCENE_ICONS = SCENE_ICONS;
