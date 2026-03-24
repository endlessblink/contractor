/**
 * Skills Pipeline — Entry Point
 *
 * Registers all skills and exports the processAIOutput convenience function.
 * Isomorphic: works in both browser and Node.js environments.
 */

import { createContext } from './context.mjs';
import { registerSkill, runPipeline, clearSkills } from './registry.mjs';
import { parseJsonSkill } from './parse-json.mjs';
import { validateSchemaSkill } from './validate-schema.mjs';
import { detectOptionsSkill } from './detect-options.mjs';
import { formatTextFieldsSkill } from './format-text-fields.mjs';
import { trimDescriptionSkill } from './trim-description.mjs';
import { logTransformsSkill } from './log-transforms.mjs';

// Register skills in execution order
clearSkills();
registerSkill(parseJsonSkill);
registerSkill(validateSchemaSkill);
registerSkill(detectOptionsSkill);
registerSkill(formatTextFieldsSkill);
registerSkill(trimDescriptionSkill);
registerSkill(logTransformsSkill);

/**
 * Process AI output through the skills pipeline.
 *
 * @param {string} rawJsonString - Raw JSON string from AI (FORM_DATA or FORM_UPDATE content)
 * @param {'FORM_DATA'|'FORM_UPDATE'} type - Type of AI output
 * @returns {Promise<{ json: Object|null, logs: string[], errors: Error[], failed: boolean, failReason: string|null }>}
 */
export async function processAIOutput(rawJsonString, type) {
  const ctx = createContext(rawJsonString, type);
  const result = await runPipeline(ctx);
  return {
    json: result.json,
    logs: result.logs,
    errors: result.errors,
    failed: result.failed,
    failReason: result.failReason,
  };
}

// Re-export for advanced usage
export { registerSkill, clearSkills, runPipeline, createContext };
