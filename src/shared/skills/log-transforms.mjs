/**
 * Log transforms skill
 * Stage: log | FailMode: graceful
 *
 * Compares snapshot (pre-transform) vs current json (post-transform).
 * Logs diffs to ctx.logs and console.
 * Toggleable via window.__SKILLS_LOG (browser) or SKILLS_LOG env var (Node).
 */

function isLoggingEnabled() {
  // Browser
  if (typeof window !== 'undefined') {
    return window.__SKILLS_LOG !== false; // on by default
  }
  // Node
  if (typeof process !== 'undefined' && process.env) {
    return process.env.SKILLS_LOG !== '0';
  }
  return true;
}

function diffObjects(before, after, prefix = '') {
  const changes = [];
  if (!before || !after) return changes;

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const bVal = before[key];
    const aVal = after[key];

    if (typeof bVal === 'string' && typeof aVal === 'string' && bVal !== aVal) {
      if (bVal.length > 50 || aVal.length > 50) {
        changes.push(`${path}: changed (${bVal.length} → ${aVal.length} chars)`);
      } else {
        changes.push(`${path}: "${bVal}" → "${aVal}"`);
      }
    } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      if (Array.isArray(bVal) && Array.isArray(aVal)) {
        changes.push(`${path}: array changed (${bVal.length} → ${aVal.length} items)`);
      } else if (typeof bVal !== typeof aVal) {
        changes.push(`${path}: type changed`);
      } else if (typeof bVal === 'object' && bVal !== null) {
        changes.push(...diffObjects(bVal, aVal, path));
      } else {
        changes.push(`${path}: ${JSON.stringify(bVal)} → ${JSON.stringify(aVal)}`);
      }
    }
  }
  return changes;
}

/** @type {import('./registry.mjs').Skill} */
export const logTransformsSkill = {
  name: 'log-transforms',
  stage: 'log',
  failMode: 'graceful',

  run(ctx) {
    if (!isLoggingEnabled()) return ctx;

    // Diff snapshot vs current
    if (ctx.snapshot && ctx.json) {
      const diffs = diffObjects(ctx.snapshot, ctx.json);
      if (diffs.length > 0) {
        ctx.logs.push(`[log-transforms] ${diffs.length} field(s) modified:`);
        diffs.forEach(d => ctx.logs.push(`  • ${d}`));
      } else {
        ctx.logs.push('[log-transforms] No transformations applied');
      }
    }

    // Output all logs to console
    if (ctx.logs.length > 0) {
      const logger = typeof console !== 'undefined' ? console : null;
      if (logger) {
        logger.debug(`[skills-pipeline] ${ctx.type} processed:`, ...ctx.logs);
        if (ctx.errors.length > 0) {
          logger.warn(`[skills-pipeline] ${ctx.errors.length} non-fatal error(s):`, ctx.errors);
        }
      }
    }

    return ctx;
  },
};
