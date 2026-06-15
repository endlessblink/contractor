/**
 * Notes-vs-clauses dedup skill
 * Stage: transform | FailMode: graceful
 *
 * Enforces "structured clauses are the single source of truth": strips any
 * generalNotes line that restates or contradicts a rendered clause, so the
 * הערות כלליות section carries only project-specific remarks.
 *
 * Reads ctx.data._clausesDb (attached by generateDocument before the pipeline)
 * and resolves the effective clauses with the same shared resolver the renderer
 * uses, so the comparison is against exactly what will be printed.
 *
 * Stripped lines are recorded on data._notesWarnings for the approve-time
 * validator/UI.
 */

import { resolveClauses } from '../clause-resolver.mjs';
import { findRedundantNotes, allClauseTexts } from '../form-validation.mjs';

/** @type {import('./registry.mjs').DocSkill} */
export const dedupeNotesSkill = {
  name: 'dedupe-notes',
  stage: 'transform',
  failMode: 'graceful',

  run(ctx) {
    const data = ctx.data;
    if (!data || !data.generalNotes || !data._clausesDb) return ctx;
    if (data.documentType === 'cv') return ctx;

    const resolved = resolveClauses(data._clausesDb, {
      documentType: data.documentType || 'quote',
      serviceType: data.serviceType || '',
      selectedClauses: data.selectedClauses || null,
      clauseEdits: data.clauseEdits || {},
      language: (data.userProfile && data.userProfile.language) || data.language || 'he',
    });

    const clauseTexts = allClauseTexts(resolved);
    if (clauseTexts.length === 0) return ctx;

    const noteLines = data.generalNotes.split('\n').filter(l => l.trim());
    const { kept, redundant } = findRedundantNotes(noteLines, clauseTexts);

    if (redundant.length > 0) {
      data.generalNotes = kept.join('\n');
      data._notesWarnings = redundant.map(r => r.line.trim());
      ctx.logs.push(`[dedupe-notes] stripped ${redundant.length} note line(s) duplicating clauses`);
    }

    return ctx;
  },
};
