/**
 * Trim projectDescription skill
 * Stage: transform | FailMode: graceful
 *
 * Keeps projectDescription short (title-like).
 * If over 80 chars, moves overflow to serviceDetails.
 */

const MAX_LENGTH = 80;

/**
 * Split text at first sentence boundary
 * @param {string} text
 * @returns {{ title: string, rest: string }}
 */
function splitAtFirstSentence(text) {
  // Try splitting at ". " or "\n"
  const separatorMatch = text.match(/[.]\s|\n/);
  if (separatorMatch && separatorMatch.index < MAX_LENGTH) {
    const idx = separatorMatch.index + 1; // include the period
    return {
      title: text.slice(0, idx).trim(),
      rest: text.slice(idx).replace(/^[\s.]+/, '').trim(),
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
    const data = ctx.json;
    if (!data) return ctx;

    // FORM_DATA: process projectDescription directly
    if (ctx.type === 'FORM_DATA' && typeof data.projectDescription === 'string' &&
        data.projectDescription.length > MAX_LENGTH) {
      const original = data.projectDescription;
      const { title, rest } = splitAtFirstSentence(original);
      data.projectDescription = title;

      if (rest) {
        data.serviceDetails = rest + (data.serviceDetails ? '\n' + data.serviceDetails : '');
      }

      ctx.logs.push(`[trim-description] Trimmed projectDescription from ${original.length} to ${title.length} chars`);
    }

    // FORM_UPDATE: process updateField for projectDescription
    if (ctx.type === 'FORM_UPDATE' && Array.isArray(data.actions)) {
      data.actions.forEach(action => {
        if (action && action.type === 'updateField' && action.field === 'projectDescription' &&
            typeof action.value === 'string' && action.value.length > MAX_LENGTH) {
          const original = action.value;
          const { title } = splitAtFirstSentence(original);
          action.value = title;
          ctx.logs.push(`[trim-description] Trimmed updateField projectDescription from ${original.length} to ${title.length} chars`);
        }
      });
    }

    return ctx;
  },
};
