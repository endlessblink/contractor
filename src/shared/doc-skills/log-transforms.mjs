/**
 * Log transforms doc-skill
 * Stage: log | FailMode: graceful
 *
 * Outputs all transformation logs to console.
 * Toggleable via window.__DOC_SKILLS_LOG (browser) or DOC_SKILLS_LOG env var (Node).
 */

function isLoggingEnabled() {
  // Browser
  if (typeof window !== 'undefined') {
    return window.__DOC_SKILLS_LOG !== false; // on by default
  }
  // Node
  if (typeof process !== 'undefined' && process.env) {
    return process.env.DOC_SKILLS_LOG !== '0';
  }
  return true;
}

/** @type {import('./registry.mjs').Skill} */
export const logTransformsSkill = {
  name: 'log-transforms',
  stage: 'log',
  failMode: 'graceful',

  run(ctx) {
    if (!isLoggingEnabled()) return ctx;

    if (ctx.logs.length > 0) {
      const logger = typeof console !== 'undefined' ? console : null;
      if (logger) {
        logger.debug(`[doc-skills-pipeline] Processed document data:`, ...ctx.logs);
        if (ctx.errors.length > 0) {
          logger.warn(`[doc-skills-pipeline] ${ctx.errors.length} non-fatal error(s):`, ctx.errors);
        }
      }
    }

    return ctx;
  },
};
