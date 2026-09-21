'use strict';

const { rejectUnknownFields, requireNonEmptyString } = require('../schema');
const {
  UNCONFIRMED_CODE,
  resolveVerify,
  waitForRetry,
  readStatus,
  statusMatches,
} = require('../readBack');

const MAX_LISTED_FAILURES = 3;

function isObject(v) {
  return v !== null && typeof v === 'object';
}

/** Short, undefined-free description of one scene sub-result, e.g. `<deviceId>/<functionCode>: DEVICE_OFFLINE`. */
function describeResult(r, index) {
  const where = [r.deviceId, r.functionCode].filter((p) => typeof p === 'string' && p !== '').join('/') || `#${index + 1}`;
  return `${where}: ${r.code || 'ACTION_FAILED'}`;
}

/**
 * `scene` action: `{type:'scene', sceneId}`. Validation requires the scene to
 * exist at save time (SCENE_NOT_FOUND otherwise, like a Sprint 5 automation);
 * execution runs it through the scene service's public `executeScene` - exactly
 * once, never re-run.
 *
 * The scene service confirms each of its actions with one immediate read-back,
 * so a device whose new state has not propagated yet comes back as
 * `UNCONFIRMED` (command sent, not confirmed). Here those sub-results are
 * re-verified: after ONE shared delay every affected device is read once more
 * (status reads only - nothing is re-sent). A sub-result that now matches
 * becomes success; the rest stay `pending`. Sub-results that failed with any
 * other code are `failed`. The action-level `status` is failed > pending >
 * success, and a non-success status always carries a `code` and an `error`.
 *
 * If the scene is deleted since the rule was saved, the thrown error is caught
 * by the ActionRegistry and reported as a failed action.
 *
 * @param {{sceneService: {getScene: Function, executeScene: Function},
 *          deviceService?: {getDeviceStatus: Function}}} deps `deviceService`
 *   is only needed for the re-verification; without it UNCONFIRMED stays pending.
 */
function createSceneAction({ sceneService, deviceService } = {}) {
  return {
    type: 'scene',

    async validate(node, { path }) {
      rejectUnknownFields(node, ['type', 'sceneId'], path);
      const sceneId = requireNonEmptyString(node.sceneId, `${path}.sceneId`);
      await sceneService.getScene(sceneId); // throws SCENE_NOT_FOUND
      return { type: 'scene', sceneId };
    },

    async execute(node, ctx) {
      const result = await sceneService.executeScene(node.sceneId);
      const sceneReportedSuccess = Boolean(result.success);
      const results = Array.isArray(result.results)
        ? result.results.map((r) => (isObject(r) ? { ...r } : { success: false }))
        : [];

      // Classify every sub-result.
      const pending = [];
      for (const r of results) {
        if (r.success === true) {
          r.status = 'success';
        } else if (r.code === UNCONFIRMED_CODE && typeof r.deviceId === 'string' && typeof r.functionCode === 'string') {
          r.status = 'pending';
          pending.push(r);
        } else {
          r.status = 'failed';
        }
      }

      // One shared delay, then one status read per distinct device.
      let confirmedAfterRetry = false;
      if (pending.length > 0 && deviceService && (await waitForRetry(resolveVerify(ctx)))) {
        const byDevice = new Map();
        for (const r of pending) {
          if (!byDevice.has(r.deviceId)) byDevice.set(r.deviceId, []);
          byDevice.get(r.deviceId).push(r);
        }
        for (const [deviceId, items] of byDevice) {
          const { status } = await readStatus(deviceService, deviceId);
          if (status === null) continue; // unreadable: stays pending
          for (const r of items) {
            if (statusMatches(status, r.functionCode, r.value)) {
              r.success = true;
              r.status = 'success';
              r.verifiedAfterRetry = true;
              delete r.error;
              delete r.code;
              confirmedAfterRetry = true;
            }
          }
        }
      }

      const failed = results.filter((r) => r.status === 'failed');
      const stillPending = results.filter((r) => r.status === 'pending');
      const base = { sceneId: node.sceneId, sceneName: result.sceneName, results };
      if (confirmedAfterRetry) base.verifiedAfterRetry = true;

      if (failed.length > 0) {
        const listed = failed.slice(0, MAX_LISTED_FAILURES).map((r) => describeResult(r, results.indexOf(r)));
        const more = failed.length > MAX_LISTED_FAILURES ? `; +${failed.length - MAX_LISTED_FAILURES} more` : '';
        return {
          ...base,
          status: 'failed',
          success: false,
          code: failed[0].code || 'SCENE_FAILED',
          error: `${failed.length} of ${results.length} scene actions failed: ${listed.join('; ')}${more}`,
        };
      }
      if (stillPending.length > 0) {
        return {
          ...base,
          status: 'pending',
          success: false,
          code: UNCONFIRMED_CODE,
          error: `${stillPending.length} scene action(s) sent but not yet confirmed by read-back`,
        };
      }
      if (!sceneReportedSuccess && !confirmedAfterRetry) {
        // The scene says it failed but gave no usable per-action detail. (If it
        // "failed" only because of steps that the re-verify has now confirmed,
        // the per-step results above are the authority and the scene succeeded.)
        return { ...base, status: 'failed', success: false, code: 'SCENE_FAILED', error: 'scene reported failure without details' };
      }
      return { ...base, status: 'success', success: true };
    },
  };
}

module.exports = createSceneAction;
