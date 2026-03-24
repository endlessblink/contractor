/**
 * Trim projectDescription doc-skill
 * Stage: transform | FailMode: graceful
 *
 * If data.projectDescription > 80 chars, splits at first sentence/comma
 * and moves overflow to data.serviceDetails.
 */

const MAX_LENGTH = 80;

/**
 * Split text at first sentence boundary
 * @param {string} text
 * @returns {{ title: string, rest: string }}
 */
function splitAtFirstSentence(text) {
  // Try splitting at ". " or "\n"
  const dotIdx = text.indexOf('. ');
  const nlIdx = text.indexOf('\n');

  // Pick the earliest valid split point within MAX_LENGTH
  let splitAt = -1;
  if (dotIdx > 0 && dotIdx < MAX_LENGTH) {
    splitAt = dotIdx + 1; // include the period
  }
  if (nlIdx > 0 && nlIdx < MAX_LENGTH && (splitAt < 0 || nlIdx < splitAt)) {
    splitAt = nlIdx;
  }

  if (splitAt > 0) {
    return {
      title: text.slice(0, splitAt).trim(),
      rest: text.slice(splitAt).replace(/^[\s.]+/, '').trim(),
    };
  }

  // Fallback: find last comma before MAX_LENGTH for a cleaner break
  const lastComma = text.lastIndexOf(',', MAX_LENGTH);
  if (lastComma > 20) {
    return {
      title: text.slice(0, lastComma).trim(),
      rest: text.slice(lastComma + 1).trim(),
    };
  }

  // Last resort: hard truncate at MAX_LENGTH
  return {
    title: text.slice(0, MAX_LENGTH).trim(),
    rest: text.slice(MAX_LENGTH).trim(),
  };
}

/** @type {import('./registry.mjs').Skill} */
export const trimDescriptionSkill = {
  name: 'trim-description',
  stage: 'transform',
  failMode: 'graceful',

  run(ctx) {
    const data = ctx.data;
    if (!data) return ctx;

    if (typeof data.projectDescription === 'string' &&
        data.projectDescription.length > MAX_LENGTH) {
      const original = data.projectDescription;
      const { title, rest } = splitAtFirstSentence(original);
      data.projectDescription = title;

      if (rest) {
        data.serviceDetails = data.serviceDetails
          ? rest + '\n' + data.serviceDetails
          : rest;
      }

      ctx.logs.push(`[trim-description] Trimmed projectDescription from ${original.length} to ${title.length} chars`);
    }

    return ctx;
  },
};
