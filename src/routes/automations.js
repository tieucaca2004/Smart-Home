'use strict';

const express = require('express');
const { statusCodeFor, errorBody } = require('./httpErrors');

/**
 * Builds the /api/automations router.
 * @param {import('../services/automationService')} automationService
 */
function createAutomationsRouter(automationService) {
  const router = express.Router();

  // GET /api/automations
  router.get('/', async (req, res) => {
    try {
      const automations = await automationService.listAutomations();
      res.json({ automations });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // POST /api/automations   body: { name, enabled, trigger: {type:'daily', time:'HH:MM'}, sceneId }
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
