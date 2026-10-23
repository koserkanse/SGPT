const { createCopilotRouter } = require('@librechat/api/copilot');
const { resolveConfigSecret } = require('@librechat/api');
const { createEvolutionStore } = require('@librechat/data-schemas');
const mongoose = require('mongoose');
const {
  requireJwtAuth,
  strictConfigMiddleware,
  requireSameOrigin,
} = require('~/server/middleware');

const router = require('express').Router();
router.use(requireJwtAuth, requireSameOrigin, strictConfigMiddleware);
router.use(
  createCopilotRouter({
    resolveSecret: resolveConfigSecret,
    evolutionStore: createEvolutionStore(mongoose),
    getAppConfig: (options) => require('~/server/services/Config/app').getAppConfig(options),
  }),
);
module.exports = router;
