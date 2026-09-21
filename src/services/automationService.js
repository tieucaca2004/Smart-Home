'use strict';

const { randomUUID } = require('crypto');

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
 * CRUD for automations: "at this time of day, run this scene". Trigger
 * evaluation itself lives in AutomationScheduler — this class only owns the
 * saved records and validates them (including that `sceneId` names a scene
 * that actually exists, via `sceneService`, so an automation can never point
 * at nothing).
 */
class AutomationService {
  /**
   * @param {import('../storage/JsonFileStore')} store
   * @param {import('./sceneService')} sceneService
   */
  constructor(store, sceneService) {
    this.store = store;
    this.sceneService = sceneService;
  }

  async listAutomations() {
    return this.store.all();
  }

  async getAutomation(id) {
    const automation = await this.store.find(id);
    if (!automation) throw notFoundError(id);
    return automation;
  }

  async createAutomation(payload) {
    const clean = validateAutomationShape(payload);
    await this.sceneService.getScene(clean.sceneId); // throws SCENE_NOT_FOUND if it doesn't exist
    const now = new Date().toISOString();
    const automation = { id: randomUUID(), ...clean, createdAt: now, updatedAt: now };
    return this.store.insert(automation);
  }

  async updateAutomation(id, payload) {
    const clean = validateAutomationShape(payload);
    await this.sceneService.getScene(clean.sceneId);
    const now = new Date().toISOString();
    const updated = await this.store.update(id, (current) => ({
      ...current,
      ...clean,
      updatedAt: now,
    }));
    if (!updated) throw notFoundError(id);
    return updated;
  }

  async deleteAutomation(id) {
    const removed = await this.store.remove(id);
    if (!removed) throw notFoundError(id);
  }
}

module.exports = AutomationService;
