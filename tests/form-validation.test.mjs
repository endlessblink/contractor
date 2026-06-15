import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { processDocData } from '../src/shared/doc-skills/index.mjs';
import {
  findRedundantNotes,
  noteMatchesClause,
  validateForm,
} from '../src/shared/form-validation.mjs';

const clausesDb = {
  clauses: {
    paymentTerms: {
      clauses: [
        {
          id: 'payment-required',
          name: 'תנאי תשלום חובה',
          text: 'תחילת העבודה מותנית בתשלום מקדמה בסך 35% מסך עלות הפרויקט.',
          appliesTo: ['quote', 'contract'],
          required: true,
        },
      ],
    },
    generalTerms: {
      clauses: [
        {
          id: 'quote-validity',
          name: 'תוקף הצעה',
          text: 'ההצעה בתוקף ל-30 יום מתאריך הנפקתה.',
          appliesTo: ['quote'],
          required: false,
        },
        {
          id: 'contract-only',
          name: 'חתימה מחייבת',
          text: 'חתימה על מסמך זה מהווה התחייבות לכל הרשום לעיל.',
          appliesTo: ['contract'],
          required: true,
        },
      ],
    },
  },
};

describe('form validation regressions', () => {
  it('reports missing customer and pricing through the public validation result', () => {
    const result = validateForm({ documentType: 'quote' }, clausesDb);

    assert.deepEqual(
      result.errors.map(error => error.code),
      ['missing-field', 'missing-field'],
    );
  });

  it('warns when a selected-clause whitelist omits a required quote clause', () => {
    const result = validateForm({
      documentType: 'quote',
      clientName: 'לקוח בדיקה',
      pricingItems: [{ description: 'שירות', quantity: 1, unitPrice: 1000 }],
      selectedClauses: ['quote-validity'],
    }, clausesDb);

    assert.ok(result.warnings.some(warning => warning.code === 'missing-required-clause'));
    assert.ok(result.warnings.some(warning => warning.he.includes('תנאי תשלום חובה')));
  });

  it('warns when a quote has no resolved payment or general terms', () => {
    const result = validateForm({
      documentType: 'quote',
      clientName: 'לקוח בדיקה',
      pricingItems: [{ description: 'שירות', quantity: 1, unitPrice: 1000 }],
      selectedClauses: ['contract-only'],
    }, clausesDb);

    assert.ok(result.warnings.some(warning => warning.code === 'quote-missing-terms'));
  });

  it('detects note lines that restate rendered clauses without flagging project-specific notes', () => {
    const lines = [
      'תחילת העבודה מותנית בתשלום מקדמה בסך 35% מסך עלות הפרויקט.',
      'המסירה תכלול קובץ מקור פתוח לעריכה עתידית.',
    ];

    const result = findRedundantNotes(lines, [
      clausesDb.clauses.paymentTerms.clauses[0].text,
    ]);

    assert.deepEqual(result.redundant.map(item => item.line), [lines[0]]);
    assert.deepEqual(result.kept, [lines[1]]);
  });

  it('keeps short unrelated notes even when they share a few legal words', () => {
    const match = noteMatchesClause(
      'תשלום נוסף רק עבור הדרכה',
      ['תחילת העבודה מותנית בתשלום מקדמה בסך 35% מסך עלות הפרויקט.'],
    );

    assert.equal(match.redundant, false);
  });
});

describe('doc-skills note dedupe regressions', () => {
  it('strips notes duplicated by selected clauses and records a warning list', () => {
    const data = {
      documentType: 'quote',
      selectedClauses: ['payment-required'],
      generalNotes: [
        'תחילת העבודה מותנית בתשלום מקדמה בסך 35% מסך עלות הפרויקט.',
        'המסירה תכלול קובץ מקור פתוח לעריכה עתידית.',
      ].join('\n'),
      _clausesDb: clausesDb,
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    assert.equal(result.data.generalNotes, 'המסירה תכלול קובץ מקור פתוח לעריכה עתידית.');
    assert.deepEqual(result.data._notesWarnings, [
      'תחילת העבודה מותנית בתשלום מקדמה בסך 35% מסך עלות הפרויקט.',
    ]);
  });
});
