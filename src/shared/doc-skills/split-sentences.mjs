/**
 * Split sentences doc-skill
 * Stage: transform | FailMode: graceful
 *
 * For data.serviceDetails: splits long lines by ". " into separate lines joined by "\n".
 * This ensures each sentence becomes a separate bullet in the document.
 */

/**
 * Split a single line by ". " into separate lines
 * @param {string} line
 * @returns {string[]}
 */
function splitLine(line) {
  if (!line.includes('. ')) return [line];

  return line
    .split('. ')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.endsWith('.') ? s : s + '.');
}

/** @type {import('./registry.mjs').Skill} */
export const splitSentencesSkill = {
  name: 'split-sentences',
  stage: 'transform',
  failMode: 'graceful',

  run(ctx) {
    const data = ctx.data;
    if (!data || typeof data.serviceDetails !== 'string') return ctx;

    const original = data.serviceDetails;
    const lines = original.split('\n');
    const result = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Only split lines that have multiple sentences and no existing structure
      const parts = splitLine(trimmed);
      result.push(...parts);
    }

    const newValue = result.join('\n');
    if (newValue !== original) {
      data.serviceDetails = newValue;
      ctx.logs.push(`[split-sentences] Split serviceDetails from ${lines.length} to ${result.length} lines`);
    }

    return ctx;
  },
};
