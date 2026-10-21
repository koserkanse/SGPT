const { createCopilotRouter } = require('@librechat/api/copilot');
const { resolveConfigSecret } = require('@librechat/api');
const {
  requireJwtAuth,
  strictConfigMiddleware,
  requireSameOrigin,
} = require('~/server/middleware');

const router = require('express').Router();
router.use(requireJwtAuth, requireSameOrigin, strictConfigMiddleware);
router.use(createCopilotRouter({ resolveSecret: resolveConfigSecret }));
module.exports = router;
