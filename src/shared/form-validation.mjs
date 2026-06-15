/**
 * Form validation + notes/clauses comparison core — isomorphic.
 *
 * Two responsibilities:
 *   1. A conservative comparison core (normalizeText / findRedundantNotes) used
 *      by both the dedupe-notes doc-skill and the validator, so there is ONE
 *      implementation of "does this note line restate a clause?".
 *   2. validateForm() — data-driven checks surfaced to the bot at approve time.
 *
 * No legal text is hardcoded — everything compares against whatever the clauses
 * DB produces via the shared resolver.
 */

import { resolveClauses, resolveDocTypeKey } from './clause-resolver.mjs';

/** Normalize Hebrew/English text for comparison. */
export function normalizeText(s) {
  return String(s || '')
    .replace(/^[•‣⁃◦•·‣\-–—]\s*/, '')
    .toLowerCase()
    .replace(/["'״׳“”‟"'`.,;:!?()\[\]{}־–—\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokenize into meaningful words (length >= 2). */
function tokens(s) {
  return normalizeText(s).split(' ').filter(w => w.length >= 2);
}

/**
 * Decide whether a single note line restates/duplicates any clause text.
 * Deliberately conservative — prefers keeping a borderline note over deleting
 * a legitimate project-specific remark (e.g. "שוטף + 30", a one-off discount).
 * Only a near-exact echo of a clause is stripped:
 *   1. direct containment either direction, or
 *   2. >= 0.7 of the note's tokens appear in the clause.
 *
 * @param {string} noteLine
 * @param {string[]} clauseTexts
 * @returns {{redundant: boolean, clauseText: string|null}}
 */
export function noteMatchesClause(noteLine, clauseTexts) {
  const noteNorm = normalizeText(noteLine);
  if (!noteNorm) return { redundant: false, clauseText: null };
  const noteTokens = tokens(noteLine);

  for (const clause of clauseTexts) {
    const clauseNorm = normalizeText(clause);
    if (!clauseNorm) continue;

    // Direct containment either direction (catches exact echoes)
    if (noteNorm.length >= 8 && (clauseNorm.includes(noteNorm) || noteNorm.includes(clauseNorm))) {
      return { redundant: true, clauseText: clause };
    }

    // Token containment: most of the note's words appear in the clause
    if (noteTokens.length >= 3) {
      const clauseTokenSet = new Set(tokens(clause));
      const shared = noteTokens.filter(t => clauseTokenSet.has(t)).length;
      if (shared / noteTokens.length >= 0.7) {
        return { redundant: true, clauseText: clause };
      }
    }
  }
  return { redundant: false, clauseText: null };
}

/**
 * Partition note lines into kept vs redundant against the given clause texts.
 * @param {string[]} noteLines
 * @param {string[]} clauseTexts
 * @returns {{kept: string[], redundant: Array<{line:string, clauseText:string}>}}
 */
export function findRedundantNotes(noteLines, clauseTexts) {
  const kept = [];
  const redundant = [];
  for (const line of noteLines) {
    if (!line || !line.trim()) continue;
    const m = noteMatchesClause(line, clauseTexts);
    if (m.redundant) redundant.push({ line, clauseText: m.clauseText });
    else kept.push(line);
  }
  return { kept, redundant };
}

/** Flatten a resolveClauses() result into a single array of clause texts. */
export function allClauseTexts(resolved) {
  const out = [];
  for (const key of Object.keys(resolved || {})) {
    for (const c of resolved[key]) if (c.text) out.push(c.text);
  }
  return out;
}

/**
 * Validate a form before document generation. Pure & deterministic (no LLM).
 *
 * @param {Object} formContext - { documentType|docType, serviceType, selectedClauses,
 *   clauseEdits, generalNotes|notes, clientName, clientCompany, pricingItems|pricing }
 * @param {Object} clausesDb - parsed clauses-db.json
 * @returns {{errors: Array, warnings: Array}}
 */
export function validateForm(formContext = {}, clausesDb = null) {
  const errors = [];
  const warnings = [];

  const documentType = formContext.documentType || formContext.docType || 'quote';
  const docTypeKey = resolveDocTypeKey(documentType);
  const selectedClauses = formContext.selectedClauses || null;
  const hasSelection = Array.isArray(selectedClauses) && selectedClauses.length > 0;

  const clientName = (formContext.clientName || '').trim();
  const pricingItems = formContext.pricingItems || formContext.pricing || [];
  const generalNotes = formContext.generalNotes || formContext.notes || '';

  // 1. Missing required fields
  if (!clientName && !(formContext.clientCompany || '').trim()) {
    errors.push({ code: 'missing-field', he: 'חסר שם לקוח או חברה.' });
  }
  if (!Array.isArray(pricingItems) || pricingItems.length === 0) {
    errors.push({ code: 'missing-field', he: 'אין פריטי תמחור.' });
  }

  if (!clausesDb || !clausesDb.clauses) {
    return { errors, warnings };
  }

  const resolved = resolveClauses(clausesDb, {
    documentType,
    serviceType: formContext.serviceType || '',
    selectedClauses,
    clauseEdits: formContext.clauseEdits || {},
    language: formContext.language || 'he',
  });

  // 2. Missing required clauses for this doc type
  for (const categoryKey of Object.keys(clausesDb.clauses)) {
    const category = clausesDb.clauses[categoryKey];
    if (!category || !Array.isArray(category.clauses)) continue;
    for (const c of category.clauses) {
      if (!c.required) continue;
      if (!c.appliesTo || !c.appliesTo.includes(docTypeKey)) continue;
      const present = hasSelection
        ? selectedClauses.includes(c.id)
        : (resolved[categoryKey] || []).some(r => r.id === c.id);
      if (!present) {
        warnings.push({
          code: 'missing-required-clause',
          he: `חסר סעיף חובה: ${c.name || c.id}`,
        });
      }
    }
  }

  // 3. Quote missing terms entirely
  if (docTypeKey === 'quote') {
    const terms = (resolved.generalTerms || []).length + (resolved.paymentTerms || []).length;
    if (terms === 0) {
      warnings.push({
        code: 'quote-missing-terms',
        he: 'להצעת המחיר אין תנאים כלליים או תנאי תשלום — מומלץ להוסיף סעיפים.',
      });
    }
  }

  // 4. Notes that duplicate/contradict clauses
  if (generalNotes) {
    const noteLines = generalNotes.split('\n').filter(l => l.trim());
    const { redundant } = findRedundantNotes(noteLines, allClauseTexts(resolved));
    for (const r of redundant) {
      warnings.push({
        code: 'notes-duplicates-clause',
        he: `הערה חוזרת על תוכן של סעיף (יוסר מההערות): "${r.line.trim().slice(0, 60)}"`,
      });
    }
  }

  return { errors, warnings };
}
