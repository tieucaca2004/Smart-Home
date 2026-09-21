'use strict';

const express = require('express');
const { statusCodeFor, errorBody } = require('./httpErrors');

/**
 * Builds the /api/scenes router.
 * @param {import('../services/sceneService')} sceneService
 */
function createScenesRouter(sceneService) {
  const router = express.Router();

  // GET /api/scenes
  router.get('/', async (req, res) => {
    try {
      const scenes = await sceneService.listScenes();
      res.json({ scenes });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // POST /api/scenes   body: { name, icon?, actions: [{deviceId, functionCode, value}] }
  router.post('/', async (req, res) => {
    try {
      const scene = await sceneService.createScene(req.body || {});
      res.status(201).json({ scene });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // GET /api/scenes/:id
  router.get('/:id', async (req, res) => {
    try {
      const scene = await sceneService.getScene(req.params.id);
      res.json({ scene });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // PUT /api/scenes/:id   body: same shape as POST (full replace)
  router.put('/:id', async (req, res) => {
    try {
      const scene = await sceneService.updateScene(req.params.id, req.body || {});
      res.json({ scene });
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // DELETE /api/scenes/:id
  router.delete('/:id', async (req, res) => {
    try {
      await sceneService.deleteScene(req.params.id);
      res.status(204).end();
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  // POST /api/scenes/:id/execute — always 200 once the scene itself is
  // found; per-action outcomes (including failures) are in the body, since
  // a partially-failed scene is a valid result, not a request error.
  router.post('/:id/execute', async (req, res) => {
    try {
      const result = await sceneService.executeScene(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(statusCodeFor(err)).json(errorBody(err));
    }
  });

  return router;
}

module.exports = createScenesRouter;
