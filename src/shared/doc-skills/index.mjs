/**
 * Doc-Skills Pipeline -- Entry Point
 *
 * Registers all doc-skills and exports the processDocData convenience function.
 * Isomorphic: works in both browser and Node.js environments.
 */

import { createDocContext } from './context.mjs';
import { registerSkill, runPipeline, clearSkills } from './registry.mjs';
import { trimDescriptionSkill } from './trim-description.mjs';
import { stripOptionPrefixSkill } from './strip-option-prefix.mjs';
import { splitSentencesSkill } from './split-sentences.mjs';
import { filterMetaTextSkill } from './filter-meta-text.mjs';
import { logTransformsSkill } from './log-transforms.mjs';
import { doctypeSectionsSkill } from './doctype-sections.mjs';

// Register skills in execution order
clearSkills();
registerSkill(trimDescriptionSkill);
registerSkill(stripOptionPrefixSkill);
registerSkill(filterMetaTextSkill);  // filter before split so meta lines don't get split
registerSkill(splitSentencesSkill);
registerSkill(doctypeSectionsSkill);
registerSkill(logTransformsSkill);

/**
 * Process document data through the doc-skills pipeline.
 * Mutates the data object in-place.
 *
 * @param {Object} data - Document generation data object
 * @returns {{ data: Object, logs: string[], errors: Error[], failed: boolean, failReason: string|null }}
 */
export function processDocData(data) {
  const ctx = createDocContext(data);
  const result = runPipeline(ctx);
  return {
    data: result.data,
    logs: result.logs,
    errors: result.errors,
    failed: result.failed,
    failReason: result.failReason,
  };
}

// Re-export for advanced usage
export { registerSkill, clearSkills, runPipeline, createDocContext };
