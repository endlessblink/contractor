import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSourceMetadata,
  detectMarkdownDocumentType,
  parseMarkdownImport,
  splitMarkdownSections,
} from '../src/markdown-import.mjs';

const fixtureUrl = new URL('./fixtures/ai-video-quote.md', import.meta.url);
const fixture = readFileSync(fixtureUrl, 'utf8');

describe('markdown import', () => {
  it('parses a structured Hebrew quote into deterministic form data', () => {
    const result = parseMarkdownImport(fixture, {
      sourceName: fileURLToPath(fixtureUrl),
    });

    assert.equal(result.documentType, 'quote');
    assert.equal(result.formData.docType, 'quote');
    assert.equal(result.formData.documentType, 'quote');
    assert.equal(result.formData.clientName, '');
    assert.equal(result.formData.projectDescription, 'הפקת שני סרטוני AI');
    assert.match(result.formData.serviceDetails, /פיתוח קונספט ויזואלי/);

    assert.equal(result.formData.pricingItems.length, 1);
    assert.deepEqual(
      result.formData.pricingItems.map(({ qty, price }) => ({ qty, price })),
      [{ qty: 2, price: 7000 }],
    );
    assert.equal(result.formData.total, 14000);
    assert.equal(result.extracted.pricing.total, 14000);

    assert.deepEqual(result.extracted.timeline.deliveryDates, ['24.6.2026', '5.7.2026']);
    assert.match(result.formData.timeline, /24\.6\.2026/);
    assert.equal(result.extracted.revisions.includedRounds, 2);
    assert.equal(result.extracted.revisions.extraRoundPrice, 900);

    assert.equal(result.formData.paymentStructure, 'custom');
    assert.deepEqual(result.formData.customInstallments, [50, 50, 0]);
    assert.deepEqual(
      result.extracted.paymentTerms.installments.map(({ percentage }) => percentage),
      [50, 50],
    );
    assert.match(result.extracted.paymentTerms.installments[0].description, /מקדמה לכל סרטון/);
    assert.match(result.extracted.paymentTerms.installments[1].description, /מסירת הסרטון הסופי/);
    assert.equal(result.extracted.paymentTerms.netDays, 30);
    assert.equal(result.extracted.vatIncluded, false);
    assert.equal(result.extracted.validityDays, 14);

    assert.ok(result.confidence.overall >= 0.8);
    assert.ok(result.warnings.some(({ code }) => code === 'missing_recipient'));
    assert.equal(result.source.kind, 'markdown');
    assert.match(result.source.sha256, /^[a-f0-9]{64}$/);
  });

  it('detects Hebrew quote, contract, and work-order headings', () => {
    assert.equal(detectMarkdownDocumentType('# הצעת מחיר\n'), 'quote');
    assert.equal(detectMarkdownDocumentType('# חוזה למתן שירותים\n'), 'contract');
    assert.equal(detectMarkdownDocumentType('# הזמנת עבודה\n'), 'work_order');
  });

  it('preserves unknown sections without mixing them into form fields', () => {
    const result = parseMarkdownImport(fixture);

    assert.equal(result.unknownSections.length, 1);
    assert.equal(result.unknownSections[0].title, 'מידע נוסף');
    assert.match(result.unknownSections[0].content, /מקטע לא ממופה/);
    assert.doesNotMatch(result.formData.serviceDetails, /מקטע לא ממופה/);
  });

  it('returns warnings and lower confidence for incomplete markdown', () => {
    const result = parseMarkdownImport('# הצעת מחיר\n\n## תיאור הפרויקט\n\nבדיקה קצרה.');

    assert.ok(result.confidence.overall < 0.8);
    assert.ok(result.warnings.some(({ code }) => code === 'missing_pricing'));
    assert.ok(result.warnings.some(({ code }) => code === 'missing_recipient'));
  });

  it('exposes deterministic section and source metadata helpers', () => {
    const sections = splitMarkdownSections(fixture);
    const first = buildSourceMetadata(fixture, { sourceName: 'quote.md' });
    const second = buildSourceMetadata(fixture, { sourceName: 'quote.md' });

    assert.ok(sections.some(({ title }) => title === 'מחיר'));
    assert.deepEqual(first, second);
    assert.equal(first.name, 'quote.md');
    assert.equal(first.headingCount, sections.length);
  });
});
