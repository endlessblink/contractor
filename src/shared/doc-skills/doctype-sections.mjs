/**
 * DocType-aware section control skill
 * Stage: transform | FailMode: graceful
 *
 * Controls which sections appear based on document type.
 * Sets flags on data that the renderer uses to include/exclude sections.
 *
 * Current rules:
 * - Signature section: only for contracts and work orders, not quotes
 * - Contract clauses (obligations, IP, termination): only for contracts/work orders
 */

/** @type {import('./registry.mjs').DocSkill} */
export const doctypeSectionsSkill = {
  name: 'doctype-sections',
  stage: 'transform',
  failMode: 'graceful',

  run(ctx) {
    const data = ctx.data;
    if (!data) return ctx;

    const docType = data.documentType || 'quote';

    // Initialize section flags
    if (!data._sectionFlags) data._sectionFlags = {};

    // Signature: only for contracts and work orders
    data._sectionFlags.showSignature = (docType === 'contract' || docType === 'workOrder');

    // Contract-specific clause sections
    const isContractLike = (docType === 'contract' || docType === 'workOrder');
    data._sectionFlags.showContractClauses = isContractLike;

    if (data._sectionFlags.showSignature === false) {
      ctx.logs.push(`[doctype-sections] Hiding signature for docType="${docType}"`);
    }

    return ctx;
  },
};
