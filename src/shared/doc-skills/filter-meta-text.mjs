/**
 * Filter meta-text doc-skill
 * Stage: transform | FailMode: graceful
 *
 * Removes lines from data.serviceDetails that match meta-patterns like
 * "שתי אופציות לבחירה", "יש לבחור אחת בלבד".
 * These are AI instructional text, not document content.
 */

const META_PATTERNS = [
  /אופציו?ת.*לבחירה/,
  /יש לבחור/,
  /בחר אחת/,
  /להלן.*אופציו?ת/,
  /שתי חלופות/,
  /יש.*לבחור.*אחת.*בלבד/,
];

/**
 * Check if a line matches any meta-pattern
 * @param {string} line
 * @returns {boolean}
 */
function isMetaLine(line) {
  return META_PATTERNS.some(re => re.test(line));
}

/** @type {import('./registry.mjs').Skill} */
export const filterMetaTextSkill = {
  name: 'filter-meta-text',
  stage: 'transform',
  failMode: 'graceful',

  run(ctx) {
    const data = ctx.data;
    if (!data || typeof data.serviceDetails !== 'string') return ctx;

    const lines = data.serviceDetails.split('\n');
    const filtered = [];
    let removedCount = 0;

    for (const line of lines) {
      if (isMetaLine(line.trim())) {
        removedCount++;
      } else {
        filtered.push(line);
      }
    }

    if (removedCount > 0) {
      data.serviceDetails = filtered.join('\n');
      ctx.logs.push(`[filter-meta-text] Removed ${removedCount} meta-text line(s)`);
    }

    return ctx;
  },
};
