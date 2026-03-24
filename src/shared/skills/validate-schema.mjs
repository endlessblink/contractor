/**
 * Schema validation skill
 * Stage: validate | FailMode: critical
 *
 * Validates required fields for FORM_DATA and FORM_UPDATE.
 * Also takes a snapshot of ctx.json for later diff logging.
 */

const VALID_ACTION_TYPES = new Set([
  'addClause', 'removeClause', 'editClause',
  'updateField', 'addPricingRow', 'removePricingRow',
  'updatePricingRow', 'setPayment', 'toggleSection',
]);

function validateFormData(data) {
  const errors = [];

  if (data.pricingItems != null && !Array.isArray(data.pricingItems)) {
    errors.push('pricingItems must be an array');
  }

  if (Array.isArray(data.pricingItems)) {
    data.pricingItems.forEach((item, i) => {
      if (item.price != null && typeof item.price !== 'number') {
        // Attempt coercion
        const num = Number(item.price);
        if (!isNaN(num)) {
          item.price = num;
        } else {
          errors.push(`pricingItems[${i}].price is not a valid number: ${item.price}`);
        }
      }
      if (item.qty != null && typeof item.qty !== 'number') {
        const num = Number(item.qty);
        if (!isNaN(num)) {
          item.qty = num;
        }
      }
    });
  }

  return errors;
}

function validateFormUpdate(data) {
  const errors = [];

  if (!Array.isArray(data.actions)) {
    errors.push('FORM_UPDATE must have an actions array');
    return errors;
  }

  data.actions.forEach((action, i) => {
    if (!action || !action.type) {
      errors.push(`actions[${i}] missing type`);
      return;
    }
    if (!VALID_ACTION_TYPES.has(action.type)) {
      errors.push(`actions[${i}] unknown type: ${action.type}`);
    }
  });

  return errors;
}

/** @type {import('./registry.mjs').Skill} */
export const validateSchemaSkill = {
  name: 'validate-schema',
  stage: 'validate',
  failMode: 'critical',

  run(ctx) {
    if (!ctx.json) {
      throw new Error('No JSON to validate (parse stage may have failed)');
    }

    const errors = ctx.type === 'FORM_DATA'
      ? validateFormData(ctx.json)
      : validateFormUpdate(ctx.json);

    if (errors.length > 0) {
      throw new Error(`Schema validation failed: ${errors.join('; ')}`);
    }

    // Take snapshot for diff logging later
    try {
      ctx.snapshot = structuredClone(ctx.json);
    } catch {
      ctx.snapshot = JSON.parse(JSON.stringify(ctx.json));
    }

    ctx.logs.push(`[validate-schema] ${ctx.type} validated OK`);
    return ctx;
  },
};
