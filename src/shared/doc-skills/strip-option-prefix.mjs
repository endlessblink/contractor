/**
 * Strip option prefix doc-skill
 * Stage: transform | FailMode: graceful
 *
 * For each data.pricingItems[], strips "אופציה X - " prefix from the description field.
 * Prevents repetition like "אופציה 1 -- אופציה 1 - חבילת תמונות"
 */

const OPTION_PREFIX_RE = /^אופציה\s*\d+\s*[–—\-:]\s*/;

/** @type {import('./registry.mjs').Skill} */
export const stripOptionPrefixSkill = {
  name: 'strip-option-prefix',
  stage: 'transform',
  failMode: 'graceful',

  run(ctx) {
    const data = ctx.data;
    if (!data || !Array.isArray(data.pricingItems)) return ctx;

    let count = 0;
    for (const item of data.pricingItems) {
      if (!item || typeof item.description !== 'string') continue;
      const original = item.description;
      const stripped = original.replace(OPTION_PREFIX_RE, '').trim();
      if (stripped !== original) {
        item.description = stripped;
        count++;
      }
    }

    if (count > 0) {
      ctx.logs.push(`[strip-option-prefix] Stripped option prefix from ${count} pricing item(s)`);
    }

    return ctx;
  },
};
