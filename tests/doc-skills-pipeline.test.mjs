import { describe, it } from 'node:test';
import assert from 'node:assert';
import { processDocData } from '../src/shared/doc-skills/index.mjs';

describe('Doc Skills Pipeline', () => {
  describe('trim-description', () => {
    it('trims long projectDescription and moves to serviceDetails', () => {
      const data = {
        projectDescription: 'יצירת תמונות שיווקיות וקטלוגיות לנעליים באמצעות AI, על בסיס טבלת מוצרים קיימת (קובץ אקסל) הכוללת דגמי נעליים שונים.',
      };
      const result = processDocData(data);
      assert.ok(result.data.projectDescription.length <= 80);
      assert.ok(result.data.serviceDetails, 'serviceDetails should contain overflow');
      assert.ok(result.data.serviceDetails.length > 0);
    });

    it('splits at comma when no period available', () => {
      const data = {
        projectDescription: 'פיתוח מערכת ניהול תוכן מתקדמת, כולל ממשק משתמש מורכב, עם תמיכה מלאה בעברית ובערבית ושפות נוספות',
      };
      const result = processDocData(data);
      assert.ok(result.data.projectDescription.length <= 80);
      // Should have split at a comma
      assert.ok(result.data.serviceDetails.length > 0);
    });

    it('leaves short descriptions unchanged', () => {
      const data = {
        projectDescription: 'פרויקט קצר ופשוט',
      };
      const result = processDocData(data);
      assert.strictEqual(result.data.projectDescription, 'פרויקט קצר ופשוט');
      assert.strictEqual(result.data.serviceDetails, undefined);
    });

    it('prepends overflow to existing serviceDetails', () => {
      const data = {
        projectDescription: 'יצירת תמונות שיווקיות וקטלוגיות לנעליים באמצעות AI, על בסיס טבלת מוצרים קיימת (קובץ אקסל) הכוללת דגמי נעליים שונים.',
        serviceDetails: 'פירוט קיים',
      };
      const result = processDocData(data);
      assert.ok(result.data.serviceDetails.includes('פירוט קיים'));
      // Overflow should be prepended
      assert.ok(result.data.serviceDetails.length > 'פירוט קיים'.length);
    });
  });

  describe('strip-option-prefix', () => {
    it('strips option prefix from pricing item descriptions', () => {
      const data = {
        pricingItems: [
          { description: 'אופציה 1 – חבילת תמונות חד-פעמית', quantity: 1, unitPrice: 2500, option: '1' },
          { description: 'אופציה 2 – וורקפלו אוטומטי מלא', quantity: 1, unitPrice: 3500, option: '2' },
        ],
      };
      const result = processDocData(data);
      assert.strictEqual(result.data.pricingItems[0].description, 'חבילת תמונות חד-פעמית');
      assert.strictEqual(result.data.pricingItems[1].description, 'וורקפלו אוטומטי מלא');
    });

    it('leaves descriptions without option prefix unchanged', () => {
      const data = {
        pricingItems: [
          { description: 'עיצוב גרפי', quantity: 1, unitPrice: 1000 },
        ],
      };
      const result = processDocData(data);
      assert.strictEqual(result.data.pricingItems[0].description, 'עיצוב גרפי');
    });

    it('handles dash variants in prefix', () => {
      const data = {
        pricingItems: [
          { description: 'אופציה 1 - חבילה בסיסית', quantity: 1, unitPrice: 1000 },
          { description: 'אופציה 2 — חבילה מורחבת', quantity: 1, unitPrice: 2000 },
        ],
      };
      const result = processDocData(data);
      assert.strictEqual(result.data.pricingItems[0].description, 'חבילה בסיסית');
      assert.strictEqual(result.data.pricingItems[1].description, 'חבילה מורחבת');
    });
  });

  describe('filter-meta-text', () => {
    it('removes lines containing "אופציות לבחירה"', () => {
      const data = {
        serviceDetails: 'שתי אופציות לבחירה (יש לבחור אחת בלבד):\nאופציה 1 - חבילה בסיסית\nאופציה 2 - חבילה מורחבת',
      };
      const result = processDocData(data);
      assert.ok(!result.data.serviceDetails.includes('אופציות לבחירה'));
    });

    it('removes lines containing "יש לבחור"', () => {
      const data = {
        serviceDetails: 'יש לבחור אחת מבין האפשרויות הבאות:\nאופציה 1\nאופציה 2',
      };
      const result = processDocData(data);
      assert.ok(!result.data.serviceDetails.includes('יש לבחור'));
    });

    it('keeps non-meta lines intact', () => {
      const data = {
        serviceDetails: 'שירות עיצוב גרפי\nכולל 3 סבבי תיקונים',
      };
      const result = processDocData(data);
      assert.ok(result.data.serviceDetails.includes('שירות עיצוב גרפי'));
      assert.ok(result.data.serviceDetails.includes('כולל 3 סבבי תיקונים'));
    });
  });

  describe('split-sentences', () => {
    it('splits serviceDetails lines with multiple sentences', () => {
      const data = {
        serviceDetails: 'יצירת עד 80 תמונות. כולל סבב תיקונים. מסירה תוך שבועיים.',
      };
      const result = processDocData(data);
      const lines = result.data.serviceDetails.split('\n');
      assert.strictEqual(lines.length, 3);
    });

    it('preserves existing newline structure', () => {
      const data = {
        serviceDetails: 'שורה ראשונה\nשורה שנייה\nשורה שלישית',
      };
      const result = processDocData(data);
      const lines = result.data.serviceDetails.split('\n');
      assert.strictEqual(lines.length, 3);
      assert.strictEqual(lines[0], 'שורה ראשונה');
    });

    it('handles mixed newlines and sentences', () => {
      const data = {
        serviceDetails: 'אופציה 1 - חבילה. יצירת תמונות. כולל תיקונים.\nאופציה 2 - מורחבת',
      };
      const result = processDocData(data);
      const lines = result.data.serviceDetails.split('\n');
      // First line should be split into 3 sentences, second stays as-is
      assert.ok(lines.length >= 4);
    });
  });

  describe('full pipeline', () => {
    it('processes complete document data end-to-end', () => {
      const data = {
        projectDescription: 'יצירת תמונות שיווקיות וקטלוגיות לנעליים באמצעות AI, על בסיס טבלת מוצרים קיימת.',
        serviceDetails: 'שתי אופציות לבחירה (יש לבחור אחת בלבד):\nאופציה 1 – חבילת תמונות. יצירת עד 80 תמונות. כולל סבב תיקונים.\nאופציה 2 – וורקפלו אוטומטי. פיתוח מערכת מלאה.',
        pricingItems: [
          { description: 'אופציה 1 – חבילת תמונות חד-פעמית', quantity: 1, unitPrice: 2500, option: '1' },
        ],
        generalNotes: 'ההצעה בתוקף ל-30 יום. המחיר אינו כולל מע״מ.',
      };
      const result = processDocData(data);

      // projectDescription should be trimmed
      assert.ok(result.data.projectDescription.length <= 80);
      // Meta text should be removed
      assert.ok(!result.data.serviceDetails.includes('שתי אופציות לבחירה'));
      // Option prefix should be stripped from pricing
      assert.ok(!result.data.pricingItems[0].description.startsWith('אופציה'));
      // No errors
      assert.strictEqual(result.failed, false);
    });

    it('handles data with no optional fields', () => {
      const data = {
        projectDescription: 'פרויקט קצר',
        pricingItems: [
          { description: 'שירות', quantity: 1, unitPrice: 500 },
        ],
      };
      const result = processDocData(data);
      assert.strictEqual(result.failed, false);
      assert.strictEqual(result.data.projectDescription, 'פרויקט קצר');
      assert.strictEqual(result.data.pricingItems[0].description, 'שירות');
    });

    it('handles empty data gracefully', () => {
      const data = {};
      const result = processDocData(data);
      assert.strictEqual(result.failed, false);
    });
  });
});
