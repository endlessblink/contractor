import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf-8');

function getModalFillHandler() {
  const start = indexHtml.indexOf("modalFillBtn.addEventListener('click'");
  assert.notStrictEqual(start, -1, 'modalFillBtn click handler should exist');
  const end = indexHtml.indexOf('function renderAnalysisModal', start);
  assert.notStrictEqual(end, -1, 'renderAnalysisModal should follow modal fill handler');
  return indexHtml.slice(start, end);
}

describe('frontend CV import regressions', () => {
  it('copies analysis data before closing the modal', () => {
    const handler = getModalFillHandler();
    const copyIndex = handler.indexOf('const d = currentAnalysisData');
    const closeIndex = handler.indexOf('closeAnalysisModal()');

    assert.ok(copyIndex !== -1, 'handler should copy currentAnalysisData into a local const');
    assert.ok(closeIndex !== -1, 'handler should close the analysis modal');
    assert.ok(copyIndex < closeIndex, 'analysis data must be copied before closeAnalysisModal clears it');
  });

  it('activates the document create editor without relying on late scoped navigation helpers', () => {
    const handler = getModalFillHandler();

    assert.ok(handler.includes("document.getElementById('view-document')?.classList.add('active')"), 'handler should activate the document view');
    assert.ok(handler.includes("document.getElementById('panel-create')?.classList.add('active')"), 'handler should activate the create panel');
    assert.ok(handler.includes("localStorage.setItem('activeTab', 'create')"), 'handler should persist the create tab');
    assert.ok(!handler.includes('navigate('), 'handler should not call navigate(), which is declared later in another script scope');
    assert.ok(!handler.includes('switchTab('), 'handler should not call switchTab(), which is not reliable from this modal path');
  });

  it('uses the rendered folder as analysis source for generated documents', () => {
    assert.ok(indexHtml.includes("const analyzeSource = options.isReference ? 'references' : folder;"), 'rendered file cards should preserve output vs uploads source');
    assert.ok(!indexHtml.includes("const analyzeSource = options.isReference ? 'references' : 'uploads';"), 'generated output files must not be analyzed as uploads');
  });
});
