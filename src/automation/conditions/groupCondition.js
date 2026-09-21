'use strict';

const { validationError, rejectUnknownFields } = require('../schema');

function validateGroup(type, node, { path, validateChild }) {
  rejectUnknownFields(node, ['type', 'conditions'], path);
  if (!Array.isArray(node.conditions) || node.conditions.length === 0) {
    throw validationError(`${path}.conditions must be a non-empty array`);
  }
  return {
    type,
    conditions: node.conditions.map((child, i) => validateChild(child, `${path}.conditions[${i}]`)),
  };
}

/**
 * `and`: any false -> false; otherwise any null (unknown) -> null; else true.
 * Children are evaluated in declaration order and evaluation stops as soon as
 * the outcome is certain (first `false`), so a cheap `time` condition placed
 * before a sensor spares the sensor read outside its window.
 */
const andCondition = {
  type: 'and',
  validate: (node, helpers) => validateGroup('and', node, helpers),
  async evaluate(node, ctx) {
    let sawUnknown = false;
    for (const child of node.conditions) {
      const result = await ctx.evaluate(child);
      if (result === false) return false;
      if (result === null) sawUnknown = true;
    }
    return sawUnknown ? null : true;
  },
};

/** `or`: any true -> true; otherwise any null (unknown) -> null; else false. Short-circuits on the first `true`. */
const orCondition = {
  type: 'or',
  validate: (node, helpers) => validateGroup('or', node, helpers),
  async evaluate(node, ctx) {
    let sawUnknown = false;
    for (const child of node.conditions) {
      const result = await ctx.evaluate(child);
      if (result === true) return true;
      if (result === null) sawUnknown = true;
    }
    return sawUnknown ? null : false;
  },
};

module.exports = { andCondition, orCondition };
