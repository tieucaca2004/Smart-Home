'use strict';

/**
 * Optional shared-token auth middleware (Round C / F-04).
 *
 * `createAuthMiddleware({ token })`:
 *   - `token` falsy (unset/empty) -> returns a middleware that only calls
 *     `next()`. True no-op: identical behavior to today, no header required
 *     anywhere. This is the default (backward compatible).
 *   - `token` truthy -> requires header `Authorization: Bearer <token>` to
 *     match exactly; otherwise answers 401 with the same `{error, code}`
 *     shape used elsewhere in the API (see src/routes/httpErrors.js).
 *
 * Protocol-agnostic: this is a generic HTTP concern, not a Tuya/device
 * concern, so it knows nothing about devices/scenes/automations.
 */
function createAuthMiddleware({ token } = {}) {
  if (!token) {
    return function noopAuth(req, res, next) {
      next();
    };
  }

  const expected = `Bearer ${token}`;

  return function requireBearerToken(req, res, next) {
    const header = req.headers['authorization'];
    if (header === expected) {
      return next();
    }
    res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
  };
}

module.exports = createAuthMiddleware;
