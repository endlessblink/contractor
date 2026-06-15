/**
 * Shared clause resolver — isomorphic (browser + Node.js).
 *
 * Single source of truth for turning the parsed clauses-db into the effective
 * set of clauses for a given document. Used by:
 *   - the DOCX renderer (src/generate-quote.mjs)
 *   - the notes-vs-clauses dedup skill (src/shared/doc-skills/dedupe-notes.mjs)
 *   - the form validator (src/shared/form-validation.mjs)
 *
 * Takes an already-parsed clausesDb object (no fs/docx deps) so each caller
 * keeps its own DB load path (PROJECT_DIR vs KNOWLEDGE_DIR in packaged mode).
 */

/** Map a documentType to the docTypeKey used in clause `appliesTo` arrays. */
export function resolveDocTypeKey(documentType) {
  return documentType === 'quote' ? 'quote'
    : documentType === 'contract' ? 'contract'
    : documentType === 'cv' ? 'cv'
    : 'workOrder';
}

/**
 * Resolve the effective clauses per category for a document.
 *
 * @param {Object} clausesDb - parsed clauses-db.json
 * @param {Object} opts
 * @param {string} opts.documentType
 * @param {string} [opts.serviceType]
 * @param {string[]|null} [opts.selectedClauses] - explicit user selection (whitelist)
 * @param {Object} [opts.clauseEdits] - per-clause text overrides keyed by id
 * @param {string} [opts.language] - 'he' | 'en'
 * @returns {Object<string, Array<{id:string, text:string, required:boolean, appliesTo:string[]}>>}
 *          map of categoryKey -> array of resolved clause objects
 */
export function resolveClauses(clausesDb, opts = {}) {
  const result = {};
  if (!clausesDb || !clausesDb.clauses) return result;

  const {
    documentType = 'quote',
    serviceType = '',
    selectedClauses = null,
    clauseEdits = {},
    language = 'he',
  } = opts;

  const docTypeKey = resolveDocTypeKey(documentType);

  // Service-template relevant clause IDs (if a serviceType is provided)
  let relevantClauseIds = null;
  if (serviceType && clausesDb.serviceTemplates) {
    const template = clausesDb.serviceTemplates.find(t => t.type === serviceType);
    if (template && template.relevantClauses) {
      relevantClauseIds = new Set(template.relevantClauses);
    }
  }

  const hasSelection = Array.isArray(selectedClauses) && selectedClauses.length > 0;

  for (const categoryKey of Object.keys(clausesDb.clauses)) {
    const category = clausesDb.clauses[categoryKey];
    if (!category || !Array.isArray(category.clauses)) continue;

    result[categoryKey] = category.clauses
      .filter(c => {
        // Must apply to this document type
        if (!c.appliesTo || !c.appliesTo.includes(docTypeKey)) return false;
        // Explicit user selection acts as a whitelist. Missing required clauses
        // are surfaced by validateForm() as warnings (so the bot/UI can add
        // them), rather than being force-included here.
        if (hasSelection) return selectedClauses.includes(c.id);
        // Service template filtering (but always include required clauses)
        if (relevantClauseIds) return relevantClauseIds.has(c.id) || c.required;
        // No template — include all clauses for this doc type
        return true;
      })
      .map(c => {
        const raw = clauseEdits[c.id] || c.text;
        const text = typeof raw === 'object'
          ? (raw[language] || raw.he || raw.en || '')
          : raw;
        return { id: c.id, text, required: !!c.required, appliesTo: c.appliesTo || [] };
      });
  }

  return result;
}

/** Get just the text strings for a category from a resolveClauses() result. */
export function getCategoryTexts(resolved, categoryKey) {
  if (!resolved || !resolved[categoryKey]) return [];
  return resolved[categoryKey].map(c => c.text).filter(Boolean);
}
