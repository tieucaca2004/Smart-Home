'use strict';

/**
 * Pure helpers that turn Tuya's "Get the specifications and properties of the
 * device" response (GET /v1.0/iot-03/devices/{device_id}/specification) into
 * the protocol-neutral capabilities shape documented on
 * DeviceAdapter.getDeviceCapabilities().
 *
 * Kept OUTSIDE TuyaAdapter.js, like normalizeTuyaErrors.js: TuyaAdapter's
 * signing/HTTP code stays the frozen, live-tested baseline, and this module
 * has no I/O so it is trivially unit-testable.
 *
 * Nothing is invented here. Every command/status entry comes straight from
 * the API's `functions` / `status` arrays. `type` and `values` stay in Tuya's
 * own vocabulary (Boolean / Integer / Enum / ...); the only transformation is
 * parsing `values`, which Tuya documents as a JSON *string*.
 */

/**
 * Parses Tuya's `values` field (a JSON string such as '{"min":0,"max":100}'
 * or '{}').
 *
 * @param {*} raw
 * @returns {object|null} the parsed constraint object; {} when absent/empty
 *   (no constraints, e.g. a Boolean); null when present but not a JSON object
 *   (so callers can tell "no constraints" from "couldn't parse"). Never throws.
 */
function parseTuyaValues(raw) {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Normalizes one Tuya `functions[]` / `status[]` array into capability entries. */
function normalizeEntries(list) {
  if (!Array.isArray(list)) return [];
  const entries = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || typeof item.code !== 'string' || item.code === '') continue;
    const entry = { code: item.code, type: item.type };
    const name = nonEmptyString(item.name);
    const desc = nonEmptyString(item.desc);
    if (name !== undefined) entry.name = name;
    if (desc !== undefined) entry.desc = desc;
    entry.values = parseTuyaValues(item.values);
    entries.push(entry);
  }
  return entries;
}

/**
 * @param {{category?: string, functions?: Array, status?: Array}} spec Tuya specification `result`
 * @returns {{category?: string, commands: Array, statuses: Array}}
 */
function normalizeTuyaSpecification(spec) {
  const source = spec && typeof spec === 'object' ? spec : {};
  const out = {
    commands: normalizeEntries(source.functions),
    statuses: normalizeEntries(source.status),
  };
  const category = nonEmptyString(source.category);
  if (category !== undefined) out.category = category;
  return out;
}

module.exports = { parseTuyaValues, normalizeTuyaSpecification };
