/**
 * Strip option prefix doc-skill
 * Stage: transform | FailMode: graceful
 *
 * For each data.pricingItems[], strips "אופציה X - " prefix from the description field.
 * Prevents repetition like "אופציה 1 -- אופציה 1 - חבילת תמונות"
 */

const OPTION_PREFIX_RE = /^אופציה\s*\d+\s*[–—\-:]\s*/;
const OPTION_LINE_RE = /^אופציה\s*\d+\s*[–—\-:]/;

/** @type {import('./registry.mjs').Skill} */
export const stripOptionPrefixSkill = {
  name: 'strip-option-prefix',
  stage: 'transform',
  failMode: 'graceful',

  run(ctx) {
    const data = ctx.data;
    if (!data) return ctx;

    let count = 0;

    // Strip from pricing item descriptions
    if (Array.isArray(data.pricingItems)) {
      for (const item of data.pricingItems) {
        if (!item || typeof item.description !== 'string') continue;
        const original = item.description;
        const stripped = original.replace(OPTION_PREFIX_RE, '').trim();
        if (stripped !== original) {
          item.description = stripped;
          count++;
        }
      }
    }

    // If only one option in pricing, clean option labels from serviceDetails too
    if (typeof data.serviceDetails === 'string' && data.serviceDetails) {
      const optionCount = new Set(
        (data.pricingItems || []).map(i => i.option).filter(Boolean)
      ).size;

      if (optionCount <= 1) {
        // Remove option header lines and "choose one" meta text
        const lines = data.serviceDetails.split('\n');
        const cleaned = lines
          .map(line => line.replace(OPTION_PREFIX_RE, '').trim())
          .filter(line => !/אופציו?ת.*לבחירה|יש לבחור|המחיר.*לאופציה הנבחרת/i.test(line));
        const result = cleaned.join('\n');
        if (result !== data.serviceDetails) {
          data.serviceDetails = result;
          count++;
          ctx.logs.push(`[strip-option-prefix] Cleaned option labels from serviceDetails (single option)`);
        }
      }
    }

    if (count > 0 && !ctx.logs.some(l => l.includes('serviceDetails'))) {
      ctx.logs.push(`[strip-option-prefix] Stripped option prefix from ${count} item(s)`);
    }

    return ctx;
  },
};
