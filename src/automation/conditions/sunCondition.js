'use strict';

const { validationError, rejectUnknownFields } = require('../schema');
const { sunEvents } = require('./sunCalc');

const EVENTS = ['sunrise', 'sunset'];
const RELATIONS = ['at', 'after', 'before'];
const MS_PER_MINUTE = 60000;

/**
 * `sun` condition: `{type:'sun', event:'sunrise'|'sunset', relation:'at'|'after'|'before', offsetMinutes?}`.
 * Let T = (that day's sunrise/sunset) + offsetMinutes, in the Hub's local day:
 *   - `at`:     true during the minute containing T
 *   - `after`:  true from T until the end of the local day
 *   - `before`: true from the start of the local day until T
 * Needs the Hub's location (ctx.location); without it, or on a polar day/night
 * with no sunrise/sunset, the result is UNKNOWN (null) — never a guess.
 */
const sunCondition = {
  type: 'sun',

  validate(node, { path, location }) {
    rejectUnknownFields(node, ['type', 'event', 'relation', 'offsetMinutes'], path);
    if (!EVENTS.includes(node.event)) {
      throw validationError(`${path}.event must be one of: ${EVENTS.join(', ')}`);
    }
    if (!RELATIONS.includes(node.relation)) {
      throw validationError(`${path}.relation must be one of: ${RELATIONS.join(', ')}`);
    }
    let offsetMinutes = 0;
    if (node.offsetMinutes !== undefined) {
      if (!Number.isInteger(node.offsetMinutes) || node.offsetMinutes < -180 || node.offsetMinutes > 180) {
        throw validationError(`${path}.offsetMinutes must be an integer between -180 and 180`);
      }
      offsetMinutes = node.offsetMinutes;
    }
    if (!location) {
      throw validationError(
        `${path}: sunrise/sunset conditions need the Hub location; set HUB_LATITUDE and HUB_LONGITUDE and restart the Hub`
      );
    }
    return { type: 'sun', event: node.event, relation: node.relation, offsetMinutes };
  },

  async evaluate(node, ctx) {
    const location = ctx.location;
    if (!location) return null;
    const events = sunEvents(ctx.now, location.latitude, location.longitude);
    if (!events) return null;

    const target = events[node.event] + (node.offsetMinutes || 0) * MS_PER_MINUTE;
    const nowMs = ctx.now.getTime();
    switch (node.relation) {
      case 'at':
        return Math.floor(nowMs / MS_PER_MINUTE) === Math.floor(target / MS_PER_MINUTE);
      case 'after': {
        const endOfDay = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + 1).getTime();
        return nowMs >= target && nowMs < endOfDay;
      }
      case 'before': {
        const startOfDay = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate()).getTime();
        return nowMs >= startOfDay && nowMs < target;
      }
      default:
        return null;
    }
  },
};

module.exports = sunCondition;
