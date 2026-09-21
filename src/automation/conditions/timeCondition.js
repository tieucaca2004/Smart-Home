'use strict';

const { HHMM, validationError, rejectUnknownFields } = require('../schema');

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * `time` condition, in the Hub's local time.
 *   - `{type:'time', at:'HH:MM'}`: true during exactly that minute.
 *   - `{type:'time', from:'HH:MM', to:'HH:MM'}`: true from `from` (inclusive)
 *     until `to` (exclusive). If `from` is later than `to` the window wraps
 *     past midnight (22:00 -> 06:00). `from` == `to` is rejected (ambiguous).
 */
const timeCondition = {
  type: 'time',

  validate(node, { path }) {
    rejectUnknownFields(node, ['type', 'at', 'from', 'to'], path);
    const hasAt = node.at !== undefined;
    const hasWindow = node.from !== undefined || node.to !== undefined;
    if (hasAt && hasWindow) {
      throw validationError(`${path} must use either "at" or "from"/"to", not both`);
    }
    if (hasAt) {
      if (typeof node.at !== 'string' || !HHMM.test(node.at)) {
        throw validationError(`${path}.at must be "HH:MM" (24h, e.g. "18:00")`);
      }
      return { type: 'time', at: node.at };
    }
    if (!hasWindow) {
      throw validationError(`${path} must have "at" or both "from" and "to"`);
    }
    if (typeof node.from !== 'string' || !HHMM.test(node.from)) {
      throw validationError(`${path}.from must be "HH:MM" (24h, e.g. "11:00")`);
    }
    if (typeof node.to !== 'string' || !HHMM.test(node.to)) {
      throw validationError(`${path}.to must be "HH:MM" (24h, e.g. "14:00")`);
    }
    if (node.from === node.to) {
      throw validationError(`${path}.from and ${path}.to must differ`);
    }
    return { type: 'time', from: node.from, to: node.to };
  },

  async evaluate(node, ctx) {
    const now = ctx.now;
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (node.at !== undefined) return minutes === toMinutes(node.at);
    const from = toMinutes(node.from);
    const to = toMinutes(node.to);
    if (from < to) return minutes >= from && minutes < to;
    return minutes >= from || minutes < to; // wraps past midnight
  },
};

module.exports = timeCondition;
