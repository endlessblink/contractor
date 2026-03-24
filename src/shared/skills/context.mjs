/**
 * @typedef {Object} SkillContext
 * @property {string} rawText - Raw JSON string from AI
 * @property {'FORM_DATA'|'FORM_UPDATE'} type
 * @property {Object|null} json - Parsed/transformed data
 * @property {Object|null} snapshot - Pre-transform snapshot for diff logging
 * @property {string[]} logs - Transformation log entries
 * @property {Error[]} errors - Non-fatal errors collected during graceful skills
 * @property {boolean} failed - True if a critical skill failed
 * @property {string|null} failReason - Why it failed
 */

/**
 * Create a fresh SkillContext
 * @param {string} rawText - Raw JSON string
 * @param {'FORM_DATA'|'FORM_UPDATE'} type
 * @returns {SkillContext}
 */
export function createContext(rawText, type) {
  return {
    rawText,
    type,
    json: null,
    snapshot: null,
    logs: [],
    errors: [],
    failed: false,
    failReason: null,
  };
}
