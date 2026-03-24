/**
 * Skill registry and pipeline runner.
 * Skills are registered at startup and run in stage order.
 */

/** @type {import('./context.mjs').Skill[]} */
const skills = [];

/**
 * Register a skill into the pipeline
 * @param {Object} skill
 * @param {string} skill.name
 * @param {'parse'|'validate'|'transform'|'log'} skill.stage
 * @param {'critical'|'graceful'} skill.failMode
 * @param {(ctx: import('./context.mjs').SkillContext) => import('./context.mjs').SkillContext|Promise<import('./context.mjs').SkillContext>} skill.run
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
const DEFAULT_STAGES = ['parse', 'validate', 'transform', 'log'];

/**
 * Run the skills pipeline on a context
 * @param {import('./context.mjs').SkillContext} ctx
 * @param {string[]} [stages] - Which stages to run, in order
 * @returns {Promise<import('./context.mjs').SkillContext>}
 */
export async function runPipeline(ctx, stages) {
  const stageOrder = stages || DEFAULT_STAGES;

  for (const stage of stageOrder) {
    for (const skill of getSkills(stage)) {
      try {
        ctx = await skill.run(ctx);
      } catch (err) {
        if (skill.failMode === 'critical') {
          ctx.failed = true;
          ctx.failReason = `[${skill.name}] ${err.message}`;
          ctx.errors.push(err);
          return ctx; // stop pipeline immediately
        }
        // graceful: log warning and continue with unchanged ctx
        ctx.errors.push(err);
        ctx.logs.push(`[${skill.name}] WARN: ${err.message} — skipped`);
      }
    }
  }

  return ctx;
}
