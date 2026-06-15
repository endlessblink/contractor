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
});
