/**
 * @typedef {Object} DocContext
 * @property {Object} data - The document generation data object (mutated in-place)
 * @property {string[]} logs - Transformation log entries
 * @property {Error[]} errors - Non-fatal errors collected during graceful skills
 * @property {boolean} failed - True if a critical skill failed
 * @property {string|null} failReason - Why it failed
 */

/**
 * Create a fresh DocContext
 * @param {Object} data - Document generation data object
 * @returns {DocContext}
 */
export function createDocContext(data) {
  return {
    data,
    logs: [],
    errors: [],
    failed: false,
    failReason: null,
  };
}
