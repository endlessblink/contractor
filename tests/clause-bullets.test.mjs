import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPreviewHTML } from '../src/render-preview.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clausesDb = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'clauses-db.json'), 'utf-8')
);

function renderContract() {
  return renderPreviewHTML(
    {
      documentType: 'contract',
      clientName: 'בדיקה',
      projectDescription: 'פרויקט בדיקה',
      pricingItems: [{ description: 'שירות', quantity: 1, unitPrice: 1000 }],
    },
    { clausesDb }
  );
}

// Regression: all legal/terms clause sections must render as bullet lists, not
// paragraphs. Six sections (IP, AI declarations, warranty, commercial
// responsibility, confidentiality, general terms) used to render as
// <p class="doc-paragraph"> — they must now be <ul class="doc-dash-list">.
test('clause sections render as bullet lists', () => {
  const html = renderContract();
  const dashLists = (html.match(/doc-dash-list/g) || []).length;
  const paragraphs = (html.match(/doc-paragraph/g) || []).length;

  // Many clause categories are present → many dash lists.
  assert.ok(dashLists >= 10, `expected >=10 bullet lists, got ${dashLists}`);
  // No clause section should fall back to prose. (At most one non-clause
  // paragraph may exist; flipping any clause back to 'paragraph' raises this.)
  assert.ok(paragraphs <= 1, `expected <=1 doc-paragraph, got ${paragraphs}`);
});

test('previously-prose clause text appears inside a bullet item, not a paragraph', () => {
  const html = renderContract();
  // Pull a real clause text from a category that used to render as prose.
  const proseCategories = [
    'generalTerms', 'confidentiality', 'intellectualProperty',
    'commercialResponsibility', 'warrantyAndCompletion', 'aiDisclaimers',
  ];
  const cat = proseCategories.find(k => (clausesDb.clauses?.[k] || []).length > 0);
  if (!cat) return; // DB without these categories — nothing to assert
  const sample = clausesDb.clauses[cat][0];
  const snippet = (sample.text || '').trim().slice(0, 20);
  if (!snippet) return;

  // The snippet should be rendered inside a list item, never inside a paragraph.
  const inParagraph = new RegExp(`doc-paragraph[^>]*>[^<]*${snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  assert.ok(!inParagraph.test(html), `clause text rendered as paragraph: "${snippet}"`);
});
