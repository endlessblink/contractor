import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderPreviewHTML } from '../src/render-preview.mjs';

const sampleData = {
  clientName: 'לקוח לדוגמה',
  clientCompany: 'חברה לדוגמה בע"מ',
  documentType: 'quote',
  projectDescription: 'פרויקט לדוגמה',
  serviceDetails: 'שירות ראשון\nשירות שני\nשירות שלישי',
  pricingItems: [
    { description: 'שירות A', quantity: 2, unitPrice: 1000 },
    { description: 'שירות B', quantity: 1, unitPrice: 3000 },
  ],
  paymentTerms: {
    type: 'two',
    installments: [
      { percentage: 35, description: 'מקדמה בתחילת עבודה' },
      { percentage: 65, description: 'יתרת התשלום בסיום' },
    ],
  },
  timeline: 'שבוע 1: תכנון\nשבוע 2: ביצוע',
  generalNotes: 'ההצעה בתוקף ל-30 יום.\nהמחיר אינו כולל מע"מ.',
  date: '24.3.26',
  userProfile: {
    name: 'ישראל ישראלי',
    nameEn: 'Israel Israeli',
    company: 'חברת דוגמה',
    title: 'מנהל פרויקטים',
    email: 'test@example.com',
    phone: '050-1234567',
  },
};

describe('renderPreviewHTML', () => {
  it('returns a string containing the doc-preview wrapper', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(typeof html === 'string');
    assert.ok(html.includes('class="doc-preview"'));
    assert.ok(html.includes('dir="rtl"'));
  });

  it('includes the date', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(html.includes('24.3.26'));
  });

  it('renders the correct title for a quote', () => {
    const html = renderPreviewHTML({ ...sampleData, documentType: 'quote' });
    assert.ok(html.includes('הצעת מחיר'));
  });

  it('renders the correct title for a contract', () => {
    const html = renderPreviewHTML({ ...sampleData, documentType: 'contract' });
    assert.ok(html.includes('חוזה עבודה'));
  });

  it('renders the correct title for a work order', () => {
    const html = renderPreviewHTML({ ...sampleData, documentType: 'workOrder' });
    assert.ok(html.includes('הזמנת עבודה'));
  });

  it('includes from/to table with client and provider names', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(html.includes('לקוח לדוגמה'));
    assert.ok(html.includes('Israel Israeli'));
    assert.ok(html.includes('חברת דוגמה'));
  });

  it('renders service details as text', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(html.includes('שירות ראשון'));
    assert.ok(html.includes('שירות שני'));
  });

  it('renders pricing table with items and totals', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(html.includes('שירות A'));
    assert.ok(html.includes('שירות B'));
    assert.ok(html.includes('doc-pricing-table'));
    // Total: 2*1000 + 1*3000 = 5000
    assert.ok(html.includes('5,000'));
  });

  it('renders payment terms', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(html.includes('תמורה ותנאי תשלום'));
    assert.ok(html.includes('35%'));
    assert.ok(html.includes('65%'));
  });

  it('renders timeline section', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(html.includes('לוחות זמנים'));
    assert.ok(html.includes('שבוע 1'));
  });

  it('renders general notes', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(html.includes('הערות כלליות'));
    assert.ok(html.includes('30 יום'));
  });

  it('does NOT render signature for quotes', () => {
    const html = renderPreviewHTML({ ...sampleData, documentType: 'quote' });
    assert.ok(!html.includes('class="doc-signature"'));
  });

  it('renders signature for contracts', () => {
    const html = renderPreviewHTML({ ...sampleData, documentType: 'contract' });
    assert.ok(html.includes('class="doc-signature"'));
    assert.ok(html.includes('שם הלקוח'));
    assert.ok(html.includes('שם מבצע העבודה'));
  });

  it('renders footer with user profile', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(html.includes('doc-footer'));
    assert.ok(html.includes('ישראל ישראלי'));
    assert.ok(html.includes('test@example.com'));
  });

  it('includes embedded CSS', () => {
    const html = renderPreviewHTML({ ...sampleData });
    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('.doc-preview'));
  });

  it('handles option-based pricing', () => {
    const data = {
      ...sampleData,
      pricingItems: [
        { description: 'בסיס', quantity: 1, unitPrice: 500 },
        { description: 'חבילה בסיסית', quantity: 1, unitPrice: 2000, option: '1' },
        { description: 'חבילה מורחבת', quantity: 1, unitPrice: 4000, option: '2' },
      ],
    };
    const html = renderPreviewHTML(data);
    assert.ok(html.includes('אופציה 1'));
    assert.ok(html.includes('אופציה 2'));
    assert.ok(html.includes('חבילה בסיסית'));
    assert.ok(html.includes('חבילה מורחבת'));
  });

  it('escapes HTML special characters', () => {
    const data = {
      ...sampleData,
      clientName: '<script>alert("xss")</script>',
    };
    const html = renderPreviewHTML(data);
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('handles empty/minimal data without errors', () => {
    const html = renderPreviewHTML({});
    assert.ok(typeof html === 'string');
    assert.ok(html.includes('doc-preview'));
  });

  it('renders clauses when clausesDb is provided', () => {
    const clausesDb = {
      clauses: {
        clientObligations: {
          clauses: [
            { id: 'co-1', text: 'הלקוח מתחייב לספק חומרים', appliesTo: ['contract'], required: true },
          ],
        },
      },
    };
    const data = { ...sampleData, documentType: 'contract' };
    const html = renderPreviewHTML(data, { clausesDb });
    assert.ok(html.includes('התחייבויות הלקוח'));
    assert.ok(html.includes('הלקוח מתחייב לספק חומרים'));
  });
});
