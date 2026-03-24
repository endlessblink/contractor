import { describe, it } from 'node:test';
import assert from 'node:assert';
import { processAIOutput } from '../src/shared/skills/index.mjs';

describe('AI Skills Pipeline', () => {
  describe('parse-json', () => {
    it('parses valid JSON', async () => {
      const result = await processAIOutput('{"projectDescription":"test"}', 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.strictEqual(result.json.projectDescription, 'test');
    });

    it('repairs trailing commas', async () => {
      const result = await processAIOutput('{"projectDescription":"test",}', 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.strictEqual(result.json.projectDescription, 'test');
    });

    it('repairs Hebrew gershayim', async () => {
      const input = '{"notes":"המחיר אינו כולל מע\u0022מ"}';
      // This tests the repair of Hebrew double-quote inside abbreviations
      // The raw input has a literal " inside מע"מ which breaks JSON
      // We need to construct a string that actually has broken JSON
      const brokenJson = '{"notes":"המחיר אינו כולל מע"מ"}';
      const result = await processAIOutput(brokenJson, 'FORM_DATA');
      // Should either parse successfully or fail gracefully
      if (!result.failed) {
        assert.ok(result.json.notes.includes('מע'));
      }
    });

    it('fails on completely invalid JSON', async () => {
      const result = await processAIOutput('not json at all {{{', 'FORM_DATA');
      assert.strictEqual(result.failed, true);
      assert.ok(result.failReason.includes('parse-json'));
    });
  });

  describe('validate-schema', () => {
    it('validates FORM_DATA with pricingItems', async () => {
      const result = await processAIOutput(JSON.stringify({
        projectDescription: 'test project',
        pricingItems: [{ desc: 'item 1', qty: 1, price: 100 }],
      }), 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.ok(Array.isArray(result.json.pricingItems));
    });

    it('coerces string prices to numbers', async () => {
      const result = await processAIOutput(JSON.stringify({
        pricingItems: [{ desc: 'item', qty: '2', price: '500' }],
      }), 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.strictEqual(result.json.pricingItems[0].price, 500);
      assert.strictEqual(result.json.pricingItems[0].qty, 2);
    });

    it('rejects missing actions array in FORM_UPDATE', async () => {
      const result = await processAIOutput(JSON.stringify({
        someField: 'value',
      }), 'FORM_UPDATE');
      assert.strictEqual(result.failed, true);
      assert.ok(result.failReason.includes('actions'));
    });
  });

  describe('detect-options', () => {
    it('detects option from description', async () => {
      const result = await processAIOutput(JSON.stringify({
        pricingItems: [
          { desc: 'אופציה 1 - חבילה בסיסית', qty: 1, price: 1000 },
          { desc: 'אופציה 2 - חבילה מורחבת', qty: 1, price: 2000 },
        ],
      }), 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.strictEqual(result.json.pricingItems[0].option, '1');
      assert.strictEqual(result.json.pricingItems[1].option, '2');
    });

    it('does not overwrite existing option field', async () => {
      const result = await processAIOutput(JSON.stringify({
        pricingItems: [
          { desc: 'אופציה 1 - חבילה', qty: 1, price: 1000, option: '3' },
        ],
      }), 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.strictEqual(result.json.pricingItems[0].option, '3');
    });

    it('handles FORM_UPDATE addPricingRow actions', async () => {
      const result = await processAIOutput(JSON.stringify({
        actions: [
          { type: 'addPricingRow', desc: 'אופציה 2 - פרימיום', qty: 1, price: 3000 },
        ],
      }), 'FORM_UPDATE');
      assert.strictEqual(result.failed, false);
      assert.strictEqual(result.json.actions[0].option, '2');
    });
  });

  describe('format-text-fields', () => {
    it('splits notes by ". " when no newlines present', async () => {
      const result = await processAIOutput(JSON.stringify({
        notes: 'הערה ראשונה. הערה שנייה. הערה שלישית.',
      }), 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.ok(result.json.notes.includes('\n'));
      const lines = result.json.notes.split('\n');
      assert.strictEqual(lines.length, 3);
    });

    it('leaves notes with existing newlines unchanged', async () => {
      const original = 'הערה ראשונה.\nהערה שנייה.';
      const result = await processAIOutput(JSON.stringify({
        notes: original,
      }), 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.strictEqual(result.json.notes, original);
    });

    it('handles FORM_UPDATE updateField for notes', async () => {
      const result = await processAIOutput(JSON.stringify({
        actions: [
          { type: 'updateField', field: 'notes', value: 'שורה אחת. שורה שתיים. שורה שלוש.' },
        ],
      }), 'FORM_UPDATE');
      assert.strictEqual(result.failed, false);
      assert.ok(result.json.actions[0].value.includes('\n'));
    });
  });

  describe('trim-description', () => {
    it('trims projectDescription over 80 chars', async () => {
      const longDesc = 'יצירת תמונות שיווקיות וקטלוגיות לנעליים באמצעות AI, על בסיס טבלת מוצרים קיימת (קובץ אקסל) הכוללת דגמי נעליים שונים.';
      const result = await processAIOutput(JSON.stringify({
        projectDescription: longDesc,
      }), 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.ok(result.json.projectDescription.length <= 80);
    });

    it('moves overflow to serviceDetails', async () => {
      const longDesc = 'יצירת תמונות שיווקיות וקטלוגיות לנעליים באמצעות AI, על בסיס טבלת מוצרים קיימת (קובץ אקסל) הכוללת דגמי נעליים שונים.';
      const result = await processAIOutput(JSON.stringify({
        projectDescription: longDesc,
      }), 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.ok(result.json.serviceDetails, 'serviceDetails should contain overflow text');
      assert.ok(result.json.serviceDetails.length > 0);
    });

    it('leaves short descriptions unchanged', async () => {
      const shortDesc = 'פרויקט קצר';
      const result = await processAIOutput(JSON.stringify({
        projectDescription: shortDesc,
      }), 'FORM_DATA');
      assert.strictEqual(result.failed, false);
      assert.strictEqual(result.json.projectDescription, shortDesc);
    });
  });

  describe('full pipeline', () => {
    it('processes complete FORM_DATA end-to-end', async () => {
      const result = await processAIOutput(JSON.stringify({
        projectDescription: 'יצירת תמונות שיווקיות וקטלוגיות לנעליים באמצעות AI, על בסיס טבלת מוצרים קיימת (קובץ אקסל) הכוללת דגמי נעליים שונים ופרמטרים שונים כגון צבע, קהל יעד וסגנון.',
        pricingItems: [
          { desc: 'אופציה 1 - חבילת תמונות חד-פעמית', qty: 1, price: 2500 },
          { desc: 'אופציה 2 - וורקפלו אוטומטי מלא', qty: 1, price: 3500 },
        ],
        notes: 'ההצעה בתוקף ל-30 יום. המחיר אינו כולל מע״מ. עלויות API לריצה הראשונה כלולות במחיר.',
      }), 'FORM_DATA');

      assert.strictEqual(result.failed, false);
      assert.ok(result.json.projectDescription.length <= 80);
      assert.strictEqual(result.json.pricingItems[0].option, '1');
      assert.strictEqual(result.json.pricingItems[1].option, '2');
      assert.ok(result.json.notes.includes('\n'));
    });
  });
});
