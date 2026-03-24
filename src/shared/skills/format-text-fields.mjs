/**
 * Format text fields skill
 * Stage: transform | FailMode: graceful
 *
 * Enforces newline separation in notes, serviceDetails, and timeline fields.
 * If no \n present but contains ". " → splits into separate lines.
 */

const TEXT_FIELDS = ['notes', 'serviceDetails', 'timeline'];

/**
 * Enforce newlines: split by ". " if no \n present
 * @param {string} value
 * @returns {string}
 */
function enforceNewlines(value) {
  if (typeof value !== 'string' || !value) return value;
  if (value.includes('\n')) return value; // already has newlines
  if (!value.includes('. ')) return value; // nothing to split

  const parts = value
    .split('. ')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.endsWith('.') ? s : s + '.');

  return parts.join('\n');
}

/** @type {import('./registry.mjs').Skill} */
export const formatTextFieldsSkill = {
  name: 'format-text-fields',
  stage: 'transform',
  failMode: 'graceful',

  run(ctx) {
    const data = ctx.json;
    if (!data) return ctx;

    // FORM_DATA: process text fields directly
    if (ctx.type === 'FORM_DATA') {
      for (const field of TEXT_FIELDS) {
        if (typeof data[field] === 'string') {
          const original = data[field];
          data[field] = enforceNewlines(data[field]);
          if (data[field] !== original) {
            const lineCount = data[field].split('\n').length;
            ctx.logs.push(`[format-text-fields] Split ${field} into ${lineCount} lines`);
          }
        }
      }
    }

    // FORM_UPDATE: process updateField actions
    if (ctx.type === 'FORM_UPDATE' && Array.isArray(data.actions)) {
      data.actions.forEach(action => {
        if (action && action.type === 'updateField' && TEXT_FIELDS.includes(action.field)) {
          const original = action.value;
          action.value = enforceNewlines(action.value);
          if (action.value !== original) {
            const lineCount = action.value.split('\n').length;
            ctx.logs.push(`[format-text-fields] Split ${action.field} into ${lineCount} lines`);
          }
        }
      });
    }

    return ctx;
  },
};
