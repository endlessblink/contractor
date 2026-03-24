/**
 * Parse & repair JSON skill
 * Stage: parse | FailMode: critical
 *
 * Attempts JSON.parse, then tries common repairs if it fails.
 */

/**
 * Attempt to repair common JSON issues
 * @param {string} text
 * @returns {string}
 */
function repairJson(text) {
  let repaired = text;

  // Fix Hebrew gershayim: מע"מ → מע״מ (replace ASCII " with Hebrew ״ inside string values)
  // This handles the common case where Hebrew abbreviations like מע"מ break JSON
  repaired = repaired.replace(/(\p{Script=Hebrew})"(\p{Script=Hebrew})/gu, '$1\u05F4$2');

  // Strip trailing commas before } or ]
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  // Fix unescaped newlines inside string values
  repaired = repaired.replace(/(?<=:\s*"[^"]*)\n([^"]*")/g, '\\n$1');

  // Try to close truncated JSON — count open/close brackets
  const opens = (repaired.match(/[{[]/g) || []).length;
  const closes = (repaired.match(/[}\]]/g) || []).length;
  const diff = opens - closes;
  if (diff > 0) {
    for (let i = 0; i < diff; i++) {
      const lastOpen = repaired.lastIndexOf('[') > repaired.lastIndexOf('{') ? ']' : '}';
      repaired += lastOpen;
    }
  }

  return repaired;
}

/** @type {import('./registry.mjs').Skill} */
export const parseJsonSkill = {
  name: 'parse-json',
  stage: 'parse',
  failMode: 'critical',

  run(ctx) {
    // Try direct parse first
    try {
      ctx.json = JSON.parse(ctx.rawText);
      return ctx;
    } catch (directErr) {
      // Attempt repair
      ctx.logs.push(`[parse-json] Direct parse failed: ${directErr.message}. Attempting repair...`);
    }

    try {
      const repaired = repairJson(ctx.rawText);
      ctx.json = JSON.parse(repaired);
      ctx.logs.push('[parse-json] Repaired JSON successfully');
      return ctx;
    } catch (repairErr) {
      throw new Error(`JSON parse failed even after repair: ${repairErr.message}`);
    }
  },
};
