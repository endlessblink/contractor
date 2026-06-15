import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import mammoth from 'mammoth';

import { createContractorServices } from '../src/contractor-services.mjs';

const tempDirs = [];

function makeServices() {
  const dataDir = mkdtempSync(join(tmpdir(), 'contractor-services-'));
  tempDirs.push(dataDir);
  return {
    dataDir,
    services: createContractorServices({
      dataDir,
      openGeneratedDocument: false,
      userProfile: {
        name: 'ספק בדיקה',
        company: 'סטודיו בדיקה',
        email: 'supplier@example.com',
        phone: '050-5555555',
      },
    }),
  };
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('Contractor shared services', () => {
  it('creates a project and preserves separate document drafts', async () => {
    const { services } = makeServices();
    const project = await services.createProject({ name: 'פרויקט סרטוני AI' });

    await services.upsertDocumentDraft({
      projectId: project.id,
      docType: 'quote',
      formState: { clientName: 'חברת הפקה', projectDescription: 'שני סרטוני AI' },
    });
    await services.upsertDocumentDraft({
      projectId: project.id,
      docType: 'contract',
      formState: { clientName: 'חברת הפקה', projectDescription: 'חוזה נפרד' },
    });

    const stored = await services.getProject({ projectId: project.id });
    assert.equal(stored.formStates.quote.projectDescription, 'שני סרטוני AI');
    assert.equal(stored.formStates.contract.projectDescription, 'חוזה נפרד');
  });

  it('generates a DOCX with descriptive custom installments and imported terms', async () => {
    const { services } = makeServices();
    const project = await services.createProject({ name: 'הפקת סרטוני AI' });
    const formState = {
      clientName: 'חברת הפקה',
      clientCompany: '',
      docType: 'quote',
      projectDescription: 'הפקת שני סרטוני AI',
      serviceDetails: [
        'פיתוח קונספט ויזואלי וכתיבת פרומפטים',
        'סאונד דיזיין ומוזיקה',
      ].join('\n'),
      pricingItems: [
        { desc: 'הפקת סרטון AI מלא (עד 40 שניות)', qty: 2, price: 7000 },
      ],
      paymentStructure: 'custom',
      customInstallments: [50, 50],
      paymentInstallments: [
        { percentage: 50, description: 'מקדמה לכל סרטון לפני תחילת העבודה עליו' },
        { percentage: 50, description: 'יתרה במסירת הסרטון הסופי' },
      ],
      paymentNotes: 'שוטף + 30 מקבלת חשבונית',
      timeline: 'סרטון ראשון (עד 40 שניות) — עד 24.6.2026\nסרטון שני (עד 40 שניות) — עד 5.7.2026',
      notes: 'שני סבבי תיקונים לכל סרטון. סבב נוסף: 900 ₪. ההצעה תקפה ל-14 ימים. המחירים אינם כוללים מע"מ.',
      documentDate: '2026-06-14',
    };

    await services.upsertDocumentDraft({ projectId: project.id, docType: 'quote', formState });
    const generated = await services.generateDocument({ projectId: project.id, docType: 'quote' });

    assert.match(generated.filename, /^הצעת מחיר/);
    const text = (await mammoth.extractRawText({ buffer: readFileSync(generated.path) })).value;
    for (const expected of [
      'הפקת שני סרטוני AI',
      '7,000',
      '14,000',
      '24.6.2026',
      '5.7.2026',
      '50%',
      'מקדמה לכל סרטון',
      'יתרה במסירת הסרטון הסופי',
      'שוטף + 30',
      '900',
      '14 ימים',
    ]) {
      assert.ok(text.includes(expected), `generated document should contain ${expected}`);
    }
  });

  it('generates quote legal terms from the clauses DB and keeps only project-specific notes', async () => {
    const { services } = makeServices();
    const project = await services.createProject({ name: 'הצעת תנאים מה-DB' });
    const formState = {
      clientName: 'לקוח תנאים',
      docType: 'quote',
      projectDescription: 'בדיקת תנאים מתוך מאגר סעיפים',
      serviceDetails: 'שירות בדיקה',
      pricingItems: [
        { desc: 'שירות בדיקה', qty: 1, price: 1000 },
      ],
      paymentStructure: 'two',
      selectedClauses: [
        'general-quote-validity',
        'general-vat-exclusion-standard',
      ],
      notes: [
        'המחיר אינו כולל מע"מ.',
        'המסירה תכלול קובץ מקור פתוח לעריכה עתידית.',
      ].join('\n'),
      documentDate: '2026-06-16',
    };

    await services.upsertDocumentDraft({ projectId: project.id, docType: 'quote', formState });
    const generated = await services.generateDocument({ projectId: project.id, docType: 'quote' });

    const text = (await mammoth.extractRawText({ buffer: readFileSync(generated.path) })).value;
    assert.match(text, /תנאים כלליים/);
    assert.match(text, /ההצעה בתוקף ל-30 יום/);
    assert.match(text, /המחיר אינו כולל מע"מ/);
    assert.match(text, /המסירה תכלול קובץ מקור פתוח לעריכה עתידית/);

    const vatOccurrences = text.match(/המחיר אינו כולל מע"מ/g) || [];
    assert.equal(vatOccurrences.length, 1, 'VAT clause should render once from clauses, not duplicate in notes');
  });

  it('writes project JSON atomically without temporary files remaining', async () => {
    const { dataDir, services } = makeServices();
    const project = await services.createProject({ name: 'Atomic Project' });
    await Promise.all(Array.from({ length: 8 }, (_, index) => services.upsertDocumentDraft({
      projectId: project.id,
      docType: 'quote',
      formState: { clientName: `לקוח ${index}`, projectDescription: `גרסה ${index}` },
    })));

    const projectPath = join(dataDir, 'projects', project.id, 'project.json');
    assert.doesNotThrow(() => JSON.parse(readFileSync(projectPath, 'utf8')));
    assert.equal(services.listProjects().projects.length, 1);
  });

  // Regression: imported quotes must be filed under a client so they are not
  // orphaned and unreachable in the UI.
  it('files an imported quote under a client when the recipient is a real name', async () => {
    const { services } = makeServices();
    const markdown = [
      '# הצעת מחיר — אתר תדמית',
      '',
      'לכבוד: חברת אורות בע"מ',
      '',
      '## מחיר',
      '| פריט | כמות | מחיר (₪) |',
      '|---|---|---|',
      '| עיצוב אתר | 1 | 8000 |',
    ].join('\n');

    const result = await services.importMarkdown({ markdown, filename: 'orot.md', useAiFallback: false });
    assert.ok(result.clientId, 'import should link a client');

    const linked = services.listClients().find(c => c.id === result.clientId);
    assert.ok(linked, 'linked client should exist');
    assert.equal(linked.name, 'חברת אורות בע"מ');

    const indexEntry = services.listProjects().projects.find(p => p.id === result.projectId);
    assert.equal(indexEntry.clientId, result.clientId, 'index entry must carry clientId so it shows under the client');
  });

  it('leaves an imported quote client-less when the recipient is only a placeholder', async () => {
    const { services } = makeServices();
    const markdown = [
      '# הצעת מחיר — סרטוני AI',
      '',
      'לכבוד: [שם הספק / חברה]',
      '',
      '## מחיר',
      '| פריט | כמות | מחיר (₪) |',
      '|---|---|---|',
      '| הפקת סרטון | 2 | 7000 |',
    ].join('\n');

    const result = await services.importMarkdown({ markdown, filename: 'ai.md', useAiFallback: false });
    assert.equal(result.clientId, null, 'placeholder recipient must not create a client');
    assert.equal(services.listClients().length, 0, 'no junk client should be created');
  });

  it('findOrCreateClient reuses an existing client instead of duplicating', async () => {
    const { services } = makeServices();
    const first = await services.findOrCreateClient({ name: 'חברת אורות בע"מ' });
    const again = await services.findOrCreateClient({ name: 'חברת אורות' });
    assert.equal(again.id, first.id, 'a fuzzy-matching name should reuse the existing client');
    assert.equal(services.listClients().length, 1);
  });
});
