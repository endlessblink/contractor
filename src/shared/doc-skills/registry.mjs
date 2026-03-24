/**
 * Doc-skill registry and pipeline runner.
 * Skills are registered at startup and run in stage order.
 */

/** @type {Array<{name: string, stage: string, failMode: string, run: function}>} */
const skills = [];

/**
 * Register a doc-skill into the pipeline
 * @param {Object} skill
 * @param {string} skill.name
 * @param {'transform'|'log'} skill.stage
 * @param {'critical'|'graceful'} skill.failMode
 * @param {(ctx: import('./context.mjs').DocContext) => import('./context.mjs').DocContext} skill.run
 */
export function registerSkill(skill) {
  skills.push(skill);
}

/**
 * Get registered skills, optionally filtered by stage
 * @param {string} [stage]
 * @returns {Object[]}
 */
export function getSkills(stage) {
  return stage ? skills.filter(s => s.stage === stage) : [...skills];
}

/**
 * Clear all registered skills (useful for testing)
 */
export function clearSkills() {
  skills.length = 0;
}

/** Default stage execution order */
const DEFAULT_STAGES = ['transform', 'log'];

/**
 * Run the doc-skills pipeline on a context
 * @param {import('./context.mjs').DocContext} ctx
 * @param {string[]} [stages] - Which stages to run, in order
 * @returns {import('./context.mjs').DocContext}
 */
export function runPipeline(ctx, stages) {
  const stageOrder = stages || DEFAULT_STAGES;

  for (const stage of stageOrder) {
    for (const skill of getSkills(stage)) {
      try {
        ctx = skill.run(ctx);
      } catch (err) {
        if (skill.failMode === 'critical') {
          ctx.failed = true;
          ctx.failReason = `[${skill.name}] ${err.message}`;
          ctx.errors.push(err);
          return ctx; // stop pipeline immediately
        }
        // graceful: log warning and continue with unchanged ctx
        ctx.errors.push(err);
        ctx.logs.push(`[${skill.name}] WARN: ${err.message} -- skipped`);
      }
    }
  }

  return ctx;
}
