import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveClauses, resolveDocTypeKey, getCategoryTexts } from '../src/shared/clause-resolver.mjs';

const clausesDb = {
  clauses: {
    generalTerms: {
      clauses: [
        { id: 'quote-validity', text: 'ההצעה בתוקף ל-30 יום.', appliesTo: ['quote'], required: false },
        { id: 'vat', text: 'המחיר אינו כולל מע"מ.', appliesTo: ['quote', 'contract'], required: true },
        { id: 'governing-law', text: 'הדין החל הוא הדין הישראלי.', appliesTo: ['contract'], required: true },
      ],
    },
    paymentTerms: {
      clauses: [
        { id: 'advance', text: 'מקדמה 45%.', appliesTo: ['quote', 'contract'], required: false },
      ],
    },
  },
};

describe('clause-resolver', () => {
  it('maps document types to clause docType keys', () => {
    assert.equal(resolveDocTypeKey('quote'), 'quote');
    assert.equal(resolveDocTypeKey('contract'), 'contract');
    assert.equal(resolveDocTypeKey('order'), 'workOrder');
    assert.equal(resolveDocTypeKey('cv'), 'cv');
  });

  it('filters clauses by appliesTo for the document type', () => {
    const quote = resolveClauses(clausesDb, { documentType: 'quote' });
    const quoteIds = quote.generalTerms.map(c => c.id);
    assert.ok(quoteIds.includes('quote-validity'));
    assert.ok(quoteIds.includes('vat'));
    assert.ok(!quoteIds.includes('governing-law'), 'contract-only clause must not appear on a quote');
  });

  it('treats selectedClauses as an exclusive whitelist — required clauses are NOT force-included', () => {
    // This locks in the design: missing required clauses are surfaced by
    // validateForm() as warnings, not silently re-added by the resolver.
    const resolved = resolveClauses(clausesDb, {
      documentType: 'quote',
      selectedClauses: ['quote-validity'], // omits the required 'vat'
    });
    const ids = resolved.generalTerms.map(c => c.id);
    assert.deepEqual(ids, ['quote-validity']);
    assert.ok(!ids.includes('vat'), 'required clause must not be force-included under a whitelist');
  });

  it('includes all applicable clauses when no selection is given', () => {
    const resolved = resolveClauses(clausesDb, { documentType: 'quote' });
    assert.equal(resolved.paymentTerms.length, 1);
    assert.equal(getCategoryTexts(resolved, 'paymentTerms')[0], 'מקדמה 45%.');
  });

  it('returns empty structures for an unknown / empty db', () => {
    assert.deepEqual(resolveClauses(null, { documentType: 'quote' }), {});
    assert.deepEqual(getCategoryTexts({}, 'generalTerms'), []);
  });
});
