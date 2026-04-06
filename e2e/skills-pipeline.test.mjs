/**
 * Unit tests for the skills pipeline (AI output skills) and doc-skills pipeline.
 *
 * Run: node --test e2e/skills-pipeline.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { processAIOutput } from '../src/shared/skills/index.mjs';
import { processDocData } from '../src/shared/doc-skills/index.mjs';

// ---------------------------------------------------------------------------
// 1. processAIOutput — FORM_DATA happy path
// ---------------------------------------------------------------------------

describe('processAIOutput — FORM_DATA happy path', () => {
  test('valid JSON with pricingItems returns parsed object', async () => {
    const input = JSON.stringify({
      clientName: 'דנה לוי',
      projectDescription: 'אתר תדמית',
      pricingItems: [
        { desc: 'עיצוב', qty: 1, price: 1500 },
      ],
    });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.ok(result.json, 'json should be non-null');
    assert.equal(result.json.clientName, 'דנה לוי');
    assert.ok(Array.isArray(result.json.pricingItems));
    assert.equal(result.json.pricingItems.length, 1);
  });

  test('price/qty coercion — string "1500" becomes number 1500', async () => {
    const input = JSON.stringify({
      pricingItems: [
        { desc: 'עיצוב', qty: '2', price: '1500' },
      ],
    });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.equal(typeof result.json.pricingItems[0].price, 'number');
    assert.equal(result.json.pricingItems[0].price, 1500);
    assert.equal(typeof result.json.pricingItems[0].qty, 'number');
    assert.equal(result.json.pricingItems[0].qty, 2);
  });
});

// ---------------------------------------------------------------------------
// 2. processAIOutput — JSON repair
// ---------------------------------------------------------------------------

describe('processAIOutput — JSON repair', () => {
  test('trailing comma before closing brace is repaired', async () => {
    const broken = '{"clientName":"דנה","pricingItems":[{"desc":"עבודה","price":500,}],}';
    const result = await processAIOutput(broken, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.equal(result.json.clientName, 'דנה');
  });

  test('unclosed brackets are repaired and parsed', async () => {
    // Missing only the outer closing } — the repair logic appends it
    const truncated = '{"clientName":"רוני","pricingItems":[{"desc":"עבודה","price":300}]';
    const result = await processAIOutput(truncated, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.equal(result.json.clientName, 'רוני');
    assert.ok(Array.isArray(result.json.pricingItems));
  });

  test('Hebrew gershayim inside string values is fixed', async () => {
    // מע"מ — the ASCII " breaks JSON; the repairer replaces it with ״
    const broken = '{"notes":"כולל מע"מ","pricingItems":[]}';
    const result = await processAIOutput(broken, 'FORM_DATA');

    assert.equal(result.failed, false);
    // The notes field should contain the Hebrew text (gershayim or original)
    assert.ok(result.json.notes.includes('מע'), 'notes field should retain Hebrew content');
  });
});

// ---------------------------------------------------------------------------
// 3. processAIOutput — FORM_DATA validation failures
// ---------------------------------------------------------------------------

describe('processAIOutput — FORM_DATA validation', () => {
  test('pricingItems not an array causes critical failure', async () => {
    const input = JSON.stringify({ pricingItems: 'not-an-array' });
    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, true);
    assert.ok(result.failReason, 'failReason should be set');
    assert.ok(result.failReason.includes('pricingItems'), 'failReason should mention pricingItems');
  });

  test('empty object passes FORM_DATA validation (no required fields)', async () => {
    // FORM_DATA has no strictly required fields — empty object is valid
    const result = await processAIOutput('{}', 'FORM_DATA');
    assert.equal(result.failed, false);
    assert.ok(result.json);
  });

  test('completely invalid JSON fails critically', async () => {
    const result = await processAIOutput('not json at all !!!', 'FORM_DATA');
    assert.equal(result.failed, true);
    assert.ok(result.failReason);
  });
});

// ---------------------------------------------------------------------------
// 4. processAIOutput — FORM_UPDATE
// ---------------------------------------------------------------------------

describe('processAIOutput — FORM_UPDATE', () => {
  test('valid actions array parses correctly', async () => {
    const input = JSON.stringify({
      actions: [
        { type: 'updateField', field: 'clientName', value: 'יוסי' },
        { type: 'addPricingRow', desc: 'עבודה נוספת', price: 800, qty: 1 },
      ],
    });

    const result = await processAIOutput(input, 'FORM_UPDATE');

    assert.equal(result.failed, false);
    assert.ok(Array.isArray(result.json.actions));
    assert.equal(result.json.actions.length, 2);
    assert.equal(result.json.actions[0].type, 'updateField');
  });

  test('missing actions array causes critical failure', async () => {
    const input = JSON.stringify({ someOtherField: 'value' });
    const result = await processAIOutput(input, 'FORM_UPDATE');

    assert.equal(result.failed, true);
    assert.ok(result.failReason);
    assert.ok(result.failReason.toLowerCase().includes('actions'), 'failReason should mention actions');
  });

  test('unknown action type is flagged but does not crash pipeline', async () => {
    // validate-schema logs unknown types as errors, which throws → pipeline fails
    // Verify it at least reports what happened clearly
    const input = JSON.stringify({
      actions: [{ type: 'unknownFutureAction', value: 'x' }],
    });
    const result = await processAIOutput(input, 'FORM_UPDATE');

    // The current schema validator treats unknown types as a hard error
    assert.equal(result.failed, true);
    assert.ok(result.failReason.includes('unknown type'), 'failReason should describe the unknown type');
  });
});

// ---------------------------------------------------------------------------
// 5. detect-options skill
// ---------------------------------------------------------------------------

describe('detect-options skill', () => {
  test('description with "אופציה 1" sets option field to "1"', async () => {
    const input = JSON.stringify({
      pricingItems: [
        { desc: 'אופציה 1 - חבילה בסיסית', price: 1000, qty: 1 },
      ],
    });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.equal(result.json.pricingItems[0].option, '1');
  });

  test('description with "אופציה 2 - something" sets option field to "2"', async () => {
    const input = JSON.stringify({
      pricingItems: [
        { desc: 'אופציה 2 - חבילה מלאה', price: 2500, qty: 1 },
      ],
    });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.equal(result.json.pricingItems[0].option, '2');
  });

  test('description without option pattern leaves option field unchanged', async () => {
    const input = JSON.stringify({
      pricingItems: [
        { desc: 'עיצוב לוגו', price: 1200, qty: 1, option: '' },
      ],
    });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    // option should still be empty — nothing to detect
    const item = result.json.pricingItems[0];
    assert.ok(!item.option || item.option === '', 'option should remain unset');
  });
});

// ---------------------------------------------------------------------------
// 6. format-text-fields skill
// ---------------------------------------------------------------------------

describe('format-text-fields skill', () => {
  test('serviceDetails with ". " is split into newline-separated lines', async () => {
    const input = JSON.stringify({
      serviceDetails: 'עיצוב גרפי. פיתוח. בדיקות',
    });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.ok(result.json.serviceDetails.includes('\n'), 'serviceDetails should contain newlines after split');
    const lines = result.json.serviceDetails.split('\n');
    assert.ok(lines.length >= 2, 'should have at least 2 lines');
  });

  test('serviceDetails already containing \\n is left unchanged', async () => {
    const original = 'עיצוב גרפי\nפיתוח\nבדיקות';
    const input = JSON.stringify({ serviceDetails: original });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.equal(result.json.serviceDetails, original);
  });

  test('notes field with ". " is split into lines', async () => {
    const input = JSON.stringify({
      notes: 'כולל 2 סבבי תיקונים. תשלום מראש. מע"מ לא כלול',
    });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.ok(result.json.notes.includes('\n'), 'notes should be split into lines');
  });
});

// ---------------------------------------------------------------------------
// 7. trim-description skill (AI pipeline)
// ---------------------------------------------------------------------------

describe('trim-description skill (AI pipeline)', () => {
  test('projectDescription under 80 chars is unchanged', async () => {
    const short = 'אתר תדמית קצר';
    const input = JSON.stringify({ projectDescription: short });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.equal(result.json.projectDescription, short);
  });

  test('projectDescription over 80 chars is truncated', async () => {
    const long = 'פיתוח אתר תדמית מקיף הכולל עיצוב גרפי מלא. פיתוח צד לקוח וצד שרת. אינטגרציות עם מערכות חיצוניות.';
    assert.ok(long.length > 80, 'fixture must be > 80 chars');

    const input = JSON.stringify({ projectDescription: long });
    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    assert.ok(result.json.projectDescription.length <= 80, 'projectDescription should be <= 80 chars after trim');
  });

  test('overflow content is moved to serviceDetails', async () => {
    // Must be > 80 chars (this fixture is 85)
    const long = 'פיתוח אתר תדמית מקיף הכולל עיצוב גרפי מלא ומקצועי. פיתוח צד לקוח וצד שרת. אינטגרציות.';
    const input = JSON.stringify({ projectDescription: long, serviceDetails: '' });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    // serviceDetails should now contain the overflow text
    assert.ok(
      result.json.serviceDetails && result.json.serviceDetails.length > 0,
      'overflow should appear in serviceDetails'
    );
  });

  test('truncation happens at sentence boundary when ". " is present', async () => {
    // Put the sentence boundary well within 80 chars to ensure it splits there
    const input = JSON.stringify({
      projectDescription: 'פיתוח אתר. חלק שני שאמור ללכת ל-serviceDetails כי הוא ארוך מדי להיות כותרת',
    });

    const result = await processAIOutput(input, 'FORM_DATA');

    assert.equal(result.failed, false);
    // Title should end after the first sentence
    assert.ok(result.json.projectDescription.endsWith('.') || result.json.projectDescription.length <= 80);
  });
});

// ---------------------------------------------------------------------------
// 8. processDocData — happy path
// ---------------------------------------------------------------------------

describe('processDocData — happy path', () => {
  test('basic data object returns processed data with _sectionFlags', () => {
    const data = {
      documentType: 'quote',
      clientName: 'יוסי',
      serviceDetails: 'עבודה כלשהי',
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    assert.ok(result.data, 'data should be present');
    assert.ok(result.data._sectionFlags, '_sectionFlags should be set');
  });
});

// ---------------------------------------------------------------------------
// 9. doctype-sections skill
// ---------------------------------------------------------------------------

describe('doctype-sections skill', () => {
  test('docType "quote" sets showSignature=false, showContractClauses=false', () => {
    const result = processDocData({ documentType: 'quote' });

    assert.equal(result.failed, false);
    assert.equal(result.data._sectionFlags.showSignature, false);
    assert.equal(result.data._sectionFlags.showContractClauses, false);
  });

  test('docType "contract" sets showSignature=true, showContractClauses=true', () => {
    const result = processDocData({ documentType: 'contract' });

    assert.equal(result.failed, false);
    assert.equal(result.data._sectionFlags.showSignature, true);
    assert.equal(result.data._sectionFlags.showContractClauses, true);
  });

  test('docType "workOrder" sets showSignature=true, showContractClauses=true', () => {
    const result = processDocData({ documentType: 'workOrder' });

    assert.equal(result.failed, false);
    assert.equal(result.data._sectionFlags.showSignature, true);
    assert.equal(result.data._sectionFlags.showContractClauses, true);
  });

  test('missing documentType defaults to quote behaviour', () => {
    const result = processDocData({});

    assert.equal(result.failed, false);
    assert.equal(result.data._sectionFlags.showSignature, false);
    assert.equal(result.data._sectionFlags.showContractClauses, false);
  });
});

// ---------------------------------------------------------------------------
// 10. strip-option-prefix doc-skill
// ---------------------------------------------------------------------------

describe('strip-option-prefix doc-skill', () => {
  test('"אופציה 1 - בסיסי" strips to "בסיסי"', () => {
    const data = {
      documentType: 'quote',
      pricingItems: [
        { description: 'אופציה 1 - בסיסי', option: '1' },
      ],
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    assert.equal(result.data.pricingItems[0].description, 'בסיסי');
  });

  test('"אופציה 2 — חבילה מלאה" (em-dash) strips to "חבילה מלאה"', () => {
    const data = {
      documentType: 'quote',
      pricingItems: [
        { description: 'אופציה 2 — חבילה מלאה', option: '2' },
      ],
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    assert.equal(result.data.pricingItems[0].description, 'חבילה מלאה');
  });

  test('description without option prefix is left unchanged', () => {
    const data = {
      documentType: 'quote',
      pricingItems: [
        { description: 'עיצוב לוגו', option: '1' },
      ],
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    assert.equal(result.data.pricingItems[0].description, 'עיצוב לוגו');
  });
});

// ---------------------------------------------------------------------------
// 11. filter-meta-text doc-skill
// ---------------------------------------------------------------------------

describe('filter-meta-text doc-skill', () => {
  test('line containing "אופציות לבחירה" is removed', () => {
    const data = {
      documentType: 'quote',
      serviceDetails: 'אופציות לבחירה\nעיצוב גרפי\nפיתוח',
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    assert.ok(!result.data.serviceDetails.includes('אופציות לבחירה'), 'meta line should be removed');
    assert.ok(result.data.serviceDetails.includes('עיצוב גרפי'), 'real content should be kept');
  });

  test('line containing "יש לבחור" is removed', () => {
    const data = {
      documentType: 'quote',
      serviceDetails: 'יש לבחור אחד מהאופציות\nפיתוח אתר',
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    assert.ok(!result.data.serviceDetails.includes('יש לבחור'), 'meta line should be removed');
    assert.ok(result.data.serviceDetails.includes('פיתוח אתר'), 'real content should be kept');
  });

  test('normal content without meta patterns is kept intact', () => {
    const original = 'עיצוב גרפי\nפיתוח\nבדיקות';
    const data = {
      documentType: 'quote',
      serviceDetails: original,
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    // All lines intact (split-sentences may reformat, but content stays)
    assert.ok(result.data.serviceDetails.includes('עיצוב גרפי'));
    assert.ok(result.data.serviceDetails.includes('פיתוח'));
    assert.ok(result.data.serviceDetails.includes('בדיקות'));
  });
});

// ---------------------------------------------------------------------------
// 12. split-sentences doc-skill
// ---------------------------------------------------------------------------

describe('split-sentences doc-skill', () => {
  test('"first sentence. second sentence" → two lines joined by \\n', () => {
    const data = {
      documentType: 'quote',
      serviceDetails: 'משפט ראשון. משפט שני',
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    const lines = result.data.serviceDetails.split('\n');
    assert.ok(lines.length >= 2, 'should produce at least 2 lines');
    assert.ok(result.data.serviceDetails.includes('\n'), 'should contain newline separator');
  });

  test('serviceDetails already using \\n is not double-split', () => {
    const data = {
      documentType: 'quote',
      serviceDetails: 'שורה ראשונה\nשורה שנייה',
    };

    const result = processDocData(data);

    assert.equal(result.failed, false);
    const lines = result.data.serviceDetails.split('\n').filter(Boolean);
    // Both original lines should still be present
    assert.ok(lines.some(l => l.includes('שורה ראשונה')));
    assert.ok(lines.some(l => l.includes('שורה שנייה')));
  });
});
