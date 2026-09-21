'use strict';

/**
 * Shared, protocol-agnostic pieces of the IF -> THEN automation schema (v2).
 *
 * Two record shapes live in the same store:
 *   - v1 (Sprint 5, "legacy"): `{ trigger: {type:'daily', time}, sceneId }`
 *   - v2 (Sprint 6, "rule"):   `{ schemaVersion: 2, when: <condition tree>, then: [<action>, ...] }`
 * A record is a rule iff it has `when` or `then`. Legacy records are never
 * rewritten by the engine: they are read and run exactly as before.
 */

/** Hard limits, so a stored rule can never be an unbounded evaluation cost. */
const LIMITS = Object.freeze({
  MAX_DEPTH: 5, // nesting depth of the condition tree (root = 1)
  MAX_NODES: 30, // total condition nodes in one rule
  MIN_ACTIONS: 1,
  MAX_ACTIONS: 20,
});

/** "HH:MM", 24h. */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True for a record/payload that carries the v2 (rule) keys. */
function hasRuleKeys(record) {
  return isPlainObject(record) && (record.when !== undefined || record.then !== undefined);
}

/** True for a record/payload that carries the v1 (Sprint 5) keys. */
function hasLegacyKeys(record) {
  return isPlainObject(record) && (record.trigger !== undefined || record.sceneId !== undefined);
}

/** A stored record is legacy (Sprint 5) iff it has no rule keys. */
function isLegacyAutomation(record) {
  return !hasRuleKeys(record);
}

/** Throws VALIDATION_ERROR naming `path` if `node` has a key outside `allowed`. */
function rejectUnknownFields(node, allowed, path) {
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) {
      throw validationError(`${path}.${key} is not a supported field`);
    }
  }
}

function requireNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validationError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

module.exports = {
  LIMITS,
  HHMM,
  validationError,
  isPlainObject,
  hasRuleKeys,
  hasLegacyKeys,
  isLegacyAutomation,
  rejectUnknownFields,
  requireNonEmptyString,
};
