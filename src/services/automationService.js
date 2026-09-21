'use strict';

const { randomUUID } = require('crypto');
const createDefaultRegistries = require('../automation/createDefaultRegistries');
const { hasRuleKeys, hasLegacyKeys, isLegacyAutomation } = require('../automation/schema');

const DAILY_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

function notFoundError(id) {
  const err = new Error(`Automation "${id}" not found`);
  err.code = 'AUTOMATION_NOT_FOUND';
  return err;
}

function schemaMismatchError(id) {
  const err = new Error(
    `Automation "${id}" is a rule (schema v2: when/then) and cannot be replaced by a trigger/sceneId payload`
  );
  err.code = 'AUTOMATION_SCHEMA_MISMATCH';
  return err;
}

function validateTrigger(trigger) {
  if (!trigger || typeof trigger !== 'object') {
    throw validationError('"trigger" must be an object');
  }
  // MVP: one trigger kind, a wall-clock time of day the Hub's own local time
  // reaches once a day. More kinds (sunset, device-state, ...) are additive
  // later; nothing here assumes "daily" is the only one that will ever exist.
  if (trigger.type !== 'daily') {
    throw validationError('"trigger.type" must be "daily" (the only trigger the MVP supports)');
  }
  if (typeof trigger.time !== 'string' || !DAILY_TIME.test(trigger.time)) {
    throw validationError('"trigger.time" must be "HH:MM" (24h, e.g. "18:00")');
  }
  return { type: 'daily', time: trigger.time };
}

function validateAutomationShape(payload) {
  if (!payload || typeof payload !== 'object') {
    throw validationError('Automation payload must be an object');
  }
  const { name, enabled, trigger, sceneId } = payload;
  if (typeof name !== 'string' || name.trim() === '') {
    throw validationError('"name" must be a non-empty string');
  }
  if (typeof enabled !== 'boolean') {
    throw validationError('"enabled" must be a boolean');
  }
  if (typeof sceneId !== 'string' || sceneId.trim() === '') {
    throw validationError('"sceneId" must be a non-empty string');
  }
  return { name: name.trim(), enabled, trigger: validateTrigger(trigger), sceneId };
}

/**
 * CRUD for automations. Two record shapes share one store:
 *   - legacy (Sprint 5): "at this time of day, run this scene" (`trigger` +
 *     `sceneId`), validated by validateAutomationShape above, unchanged.
 *   - rule (Sprint 6, schema v2): IF -> THEN (`when` condition tree + `then`
 *     action list), validated through the injected condition/action registries.
 * Trigger/condition evaluation lives elsewhere (AutomationScheduler +
 * RuleEngine) — this class only owns the saved records and validates them
 * (including that any referenced scene actually exists, via `sceneService`,
 * so an automation can never point at nothing).
 */
class AutomationService {
  /**
   * @param {import('../storage/JsonFileStore')} store
   * @param {import('./sceneService')} sceneService
   * @param {{conditionRegistry?: object, actionRegistry?: object, location?: ({latitude:number, longitude:number}|null)}} [options]
   *   Optional; the built-in registries are used by default. `location` is the
   *   Hub location, needed only to accept sunrise/sunset conditions.
   */
  constructor(store, sceneService, options = {}) {
    this.store = store;
    this.sceneService = sceneService;
    const defaults =
      options.conditionRegistry && options.actionRegistry ? {} : createDefaultRegistries({ sceneService });
    this.conditionRegistry = options.conditionRegistry || defaults.conditionRegistry;
    this.actionRegistry = options.actionRegistry || defaults.actionRegistry;
    this.location = options.location || null;
  }

  /**
   * By default only legacy (Sprint 5) records are returned, exactly as before
   * Sprint 6, so existing clients keep parsing the list. `{ includeRules: true }`
   * returns everything (rules too), in stored order.
   */
  async listAutomations(options = {}) {
    const all = await this.store.all();
    if (options && options.includeRules) return all;
    return all.filter(isLegacyAutomation);
  }

  async getAutomation(id) {
    const automation = await this.store.find(id);
    if (!automation) throw notFoundError(id);
    return automation;
  }

  /**
   * Validates a payload of either shape. Returns `{ kind: 'legacy'|'rule', clean }`.
   * A payload mixing both shapes' keys is rejected.
   */
  async _validate(payload) {
    if (hasRuleKeys(payload) && hasLegacyKeys(payload)) {
      throw validationError('Payload mixes "when"/"then" with "trigger"/"sceneId"; use one shape');
    }
    if (!hasRuleKeys(payload)) {
      const clean = validateAutomationShape(payload);
      await this.sceneService.getScene(clean.sceneId); // throws SCENE_NOT_FOUND if it doesn't exist
      return { kind: 'legacy', clean };
    }
    const { name, enabled } = payload;
    if (typeof name !== 'string' || name.trim() === '') {
      throw validationError('"name" must be a non-empty string');
    }
    if (typeof enabled !== 'boolean') {
      throw validationError('"enabled" must be a boolean');
    }
    const when = this.conditionRegistry.validateTree(payload.when, { path: 'when', location: this.location });
    const then = await this.actionRegistry.validateList(payload.then, { path: 'then' });
    return { kind: 'rule', clean: { name: name.trim(), enabled, schemaVersion: 2, when, then } };
  }

  async createAutomation(payload) {
    const { clean } = await this._validate(payload);
    const now = new Date().toISOString();
    const automation = { id: randomUUID(), ...clean, createdAt: now, updatedAt: now };
    return this.store.insert(automation);
  }

  async updateAutomation(id, payload) {
    const { kind, clean } = await this._validate(payload);
    const now = new Date().toISOString();
    const updated = await this.store.update(id, (current) => {
      if (kind === 'legacy') {
        // A Sprint 5 style payload must never overwrite a rule (an old client
        // toggling `enabled` would otherwise destroy its conditions/actions).
        if (!isLegacyAutomation(current)) throw schemaMismatchError(id);
        return { ...current, ...clean, updatedAt: now };
      }
      // Rule payload: full replace; drop the legacy keys when upgrading a v1 record.
      // eslint-disable-next-line no-unused-vars
      const { trigger, sceneId, ...rest } = current;
      return { ...rest, ...clean, updatedAt: now };
    });
    if (!updated) throw notFoundError(id);
    return updated;
  }

  async deleteAutomation(id) {
    const removed = await this.store.remove(id);
    if (!removed) throw notFoundError(id);
  }
}

module.exports = AutomationService;
