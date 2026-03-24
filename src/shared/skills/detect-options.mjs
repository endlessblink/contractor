/**
 * Auto-detect pricing options skill
 * Stage: transform | FailMode: graceful
 *
 * Scans pricing item descriptions for "אופציה X" and sets the option field.
 */

const OPTION_RE = /אופציה\s*(\d+)/;

function detectOptionFromDesc(desc) {
  if (typeof desc !== 'string') return null;
  const m = desc.match(OPTION_RE);
  return m ? m[1] : null;
}

function processPricingItems(items, logs) {
  if (!Array.isArray(items)) return;
  let count = 0;

  items.forEach(item => {
    if (!item) return;
    const desc = item.desc || item.description || '';
    if (!item.option || String(item.option).trim() === '') {
      const detected = detectOptionFromDesc(desc);
      if (detected) {
        item.option = detected;
        count++;
        logs.push(`[detect-options] Set option=${detected} on: "${desc.slice(0, 40)}..."`);
      }
    }
  });

  return count;
}

/** @type {import('./registry.mjs').Skill} */
export const detectOptionsSkill = {
  name: 'detect-options',
  stage: 'transform',
  failMode: 'graceful',

  run(ctx) {
    const data = ctx.json;
    if (!data) return ctx;

    // FORM_DATA: process pricingItems directly
    if (ctx.type === 'FORM_DATA' && data.pricingItems) {
      processPricingItems(data.pricingItems, ctx.logs);
    }

    // FORM_UPDATE: process addPricingRow and updatePricingRow actions
    if (ctx.type === 'FORM_UPDATE' && Array.isArray(data.actions)) {
      data.actions.forEach(action => {
        if (!action) return;
        if ((action.type === 'addPricingRow' || action.type === 'updatePricingRow') &&
            (!action.option || String(action.option).trim() === '')) {
          const detected = detectOptionFromDesc(action.desc || action.description || '');
          if (detected) {
            action.option = detected;
            ctx.logs.push(`[detect-options] Set option=${detected} on action: ${action.type}`);
          }
        }
      });
    }

    return ctx;
  },
};
