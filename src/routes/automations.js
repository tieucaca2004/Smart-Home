'use strict';

const express = require('express');
const { statusCodeFor, errorBody } = require('./httpErrors');
const { isLegacyAutomation } = require('../automation/schema');

/**
 * Builds the /api/automations router.
 *
 * Two record shapes (see src/automation/schema.js):
 *   - legacy (Sprint 5)  body: { name, enabled, trigger: {type:'daily', time:'HH:MM'}, sceneId }
 *   - rule (Sprint 6)    body: { name, enabled, when: <condition tree>, then: [<action>, ...] }
 * A PUT with the legacy shape onto a rule answers 409 AUTOMATION_SCHEMA_MISMATCH.
 *
 * @param {import('../services/automationService')} automationService
 * @param {{ruleEngine?: import('../automation/RuleEngine')}} [options]
 */
function createAutomationsRouter(automationService, options = {}) {
  const router = express.Router();
  const ruleEngine = options.ruleEngine || null;

  // GET /api/automations            -> legacy (Sprint 5) records only, as before Sprint 6
  // GET /api/automations?include=all -> legacy + rules
  router.get('/', async (req, res) => {
    try {
      const automations = await automationService.listAutomations({ includeRules: req.query.include === 'all' });
      res.json({ automations });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // POST /api/automations   body: legacy or rule shape (see above)
  router.post('/', async (req, res) => {
    try {
      const automation = await automationService.createAutomation(req.body || {});
      res.status(201).json({ automation });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // GET /api/automations/:id
  router.get('/:id', async (req, res) => {
    try {
      const automation = await automationService.getAutomation(req.params.id);
      res.json({ automation });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // POST /api/automations/:id/evaluate
  // Dry run: evaluates the rule's condition tree against live device state and
  // returns { result: true|false|null, tree }. Never runs an action and never
  // touches the edge-trigger state.
  router.post('/:id/evaluate', async (req, res) => {
    try {
      const automation = await automationService.getAutomation(req.params.id);
      if (isLegacyAutomation(automation)) {
        return res.json({
          automationId: automation.id,
          legacy: true,
          result: null,
          tree: null,
          note: 'Legacy (Sprint 5) automation: it has a daily trigger, not a condition tree',
        });
      }
      if (!ruleEngine) {
        return res.status(500).json({ error: 'Rule engine is not available', code: 'INTERNAL_ERROR' });
      }
      const { result, tree } = await ruleEngine.evaluateRule(automation, new Date());
      return res.json({ automationId: automation.id, enabled: automation.enabled, result, tree });
    } catch (err) {
      return res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // PUT /api/automations/:id   body: same shape as POST (full replace)
  router.put('/:id', async (req, res) => {
    try {
      const automation = await automationService.updateAutomation(req.params.id, req.body || {});
      res.json({ automation });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // DELETE /api/automations/:id
  router.delete('/:id', async (req, res) => {
    try {
      await automationService.deleteAutomation(req.params.id);
      res.status(204).end();
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  return router;
}

module.exports = createAutomationsRouter;
