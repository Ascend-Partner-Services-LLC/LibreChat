/**
 * Statsig event logger for AI usage analytics.
 * Uses the official @statsig/statsig-node-core SDK when installed. Call initialize() at server startup.
 * No-op when STATSIG_SERVER_SECRET_KEY is unset or when the SDK is not installed. Fire-and-forget; never throws to callers.
 * @see https://docs.statsig.com/server-core/node-core
 * @see https://docs.statsig.com/guides/logging-events
 */

const { logger } = require('@librechat/data-schemas');

let statsigInstance = null;
let StatsigUserClass = null;
let sdkUnavailable = false;

function loadSDK() {
  if (sdkUnavailable) {
    return false;
  }
  if (StatsigUserClass != null) {
    return true;
  }
  try {
    const sdk = require('@statsig/statsig-node-core');
    StatsigUserClass = sdk.StatsigUser;
    return true;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' || err.message?.includes('Cannot find module')) {
      sdkUnavailable = true;
      logger.debug('[Statsig] SDK not installed (@statsig/statsig-node-core); events disabled');
    }
    return false;
  }
}

/**
 * Initialize the Statsig SDK. Call once at server startup.
 * No-op if STATSIG_SERVER_SECRET_KEY is not set or SDK is not installed.
 * @returns {Promise<void>}
 */
async function initialize() {
  const apiKey = process.env.STATSIG_SERVER_SECRET_KEY;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    return;
  }
  if (!loadSDK()) {
    return;
  }
  try {
    const { Statsig } = require('@statsig/statsig-node-core');
    statsigInstance = new Statsig(apiKey.trim());
    await statsigInstance.initialize();
    logger.debug('[Statsig] SDK initialized');
  } catch (err) {
    logger.debug('[Statsig] SDK initialization failed:', err?.message || err);
    statsigInstance = null;
  }
}

/**
 * Shutdown the Statsig SDK and flush pending events. Call before process exit if possible.
 * @returns {Promise<void>}
 */
async function shutdown() {
  if (statsigInstance == null) {
    return;
  }
  try {
    await statsigInstance.shutdown();
  } catch (err) {
    logger.debug('[Statsig] shutdown failed:', err?.message || err);
  } finally {
    statsigInstance = null;
  }
}

/**
 * Log a single event to Statsig. Non-blocking; errors are logged but not thrown.
 * @param {string} userId - LibreChat user id
 * @param {string} eventName - e.g. ascend_ai_question_asked, ascend_ai_tokens_used, ascend_ai_feedback
 * @param {number} [value] - Optional numeric value (e.g. token count)
 * @param {Record<string, string|number|boolean>} [metadata] - Optional; values stringified for Statsig
 * @param {{ email?: string, firm_name?: string, role?: string }} [opts] - Optional; email, firm_name (Statsig customIDs.firmID for segmentation), role (user custom)
 */
function logEvent(userId, eventName, value = undefined, metadata = {}, opts = {}) {
  if (statsigInstance == null || !loadSDK()) {
    return;
  }

  const stringMetadata = Object.fromEntries(
    Object.entries(metadata).map(([k, v]) => [k, v == null ? '' : String(v)]),
  );

  const userOptions = {
    userID: String(userId),
  };
  if (opts.email && typeof opts.email === 'string' && opts.email.trim() !== '') {
    userOptions.email = String(opts.email).trim();
  }
  if (opts.firm_name != null && String(opts.firm_name).trim() !== '') {
    userOptions.customIDs = { firmID: String(opts.firm_name).trim() };
  }
  if (opts.role != null && String(opts.role).trim() !== '') {
    userOptions.custom = userOptions.custom || {};
    userOptions.custom.role = String(opts.role).trim();
  }
  const user = new StatsigUserClass(userOptions);

  try {
    statsigInstance.logEvent(
      user,
      eventName,
      value !== undefined && value !== null ? Number(value) : null,
      stringMetadata,
    );
  } catch (err) {
    logger.debug(`[Statsig] logEvent failed for ${eventName}:`, err?.message || err);
  }
}

module.exports = { initialize, shutdown, logEvent };
