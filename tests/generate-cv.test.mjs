import { describe, it } from 'node:test';
import assert from 'node:assert';
import { inflateRawSync } from 'node:zlib';
import mammoth from 'mammoth';
import { generateDocument } from '../src/generate-quote.mjs';

function extractZipEntry(buffer, entryName) {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === eocdSignature) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('ZIP end of central directory not found');

  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirOffset;
  const end = centralDirOffset + centralDirSize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf-8');

    if (fileName === entryName) {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error('Invalid ZIP local header');
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
      if (compressionMethod === 0) return compressed.toString('utf-8');
      if (compressionMethod === 8) return inflateRawSync(compressed).toString('utf-8');
      throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP entry not found: ${entryName}`);
}

const cvData = {
  fullName: 'נועם נאומובסקי',
  headline: 'יוצר תוכן AI, מפתח כלים ומדריך',
  location: 'רמת גן',
  phone: '052-6784960',
  email: 'noamnau@gmail.com',
  links: [
    { label: 'LinkedIn', url: 'linkedin.com/in/noamnaumovsky' },
    { label: 'GitHub', url: 'github.com/endlessblink' },
  ],
  profile: 'יוצר תוכן AI, מפתח כלים ומדריך עצמאי עם רקע בעריכת וידאו, אנימציה והוראת קולנוע.',
  sections: [
    {
      title: 'ניסיון מקצועי',
      items: [
        {
          title: 'מייסד ויוצר ראשי',
          organization: 'Noam Naumovsky Productions',
          dates: '2023 – היום',
          bullets: [
            'הפקה מקצה לקצה של וידאו AI לקמפיינים ותוכן רשתות חברתיות.',
            'פיתוח workflows שמחברים פרומפטים, תבניות ושלבי עריכה לאיטרציה מהירה.',
          ],
        },
      ],
    },
  ],
  skills: [
    { category: 'AI Video', items: ['Veo', 'Kling', 'ComfyUI'] },
    { category: 'AI Development', items: ['Claude', 'MCP servers', 'Remotion'] },
  ],
  languages: ['עברית — שפת אם', 'אנגלית — רמה גבוהה'],
};

describe('generateDocument CV', () => {
  it('generates a readable Hebrew CV DOCX from cvData', async () => {
    const buffer = await generateDocument({
      documentType: 'cv',
      clientName: 'נועם נאומובסקי',
      projectDescription: 'יוצר תוכן AI, מפתח כלים ומדריך',
      serviceDetails: cvData.profile,
      cvData,
      userProfile: { language: 'he' },
    });

    assert.ok(buffer.length > 1000);

    const extracted = await mammoth.extractRawText({ buffer });
    assert.ok(extracted.value.includes('נועם נאומובסקי'));
    assert.ok(extracted.value.includes('פרופיל'));
    assert.ok(extracted.value.includes('ניסיון מקצועי'));
    assert.ok(extracted.value.includes('כישורים וכלים'));
    assert.ok(extracted.value.includes('שפות'));
    assert.ok(extracted.value.includes('github.com/endlessblink'));

    const documentXml = extractZipEntry(buffer, 'word/document.xml');
    const bidiParagraphs = (documentXml.match(/<w:bidi/g) || []).length;
    const rtlRuns = (documentXml.match(/<w:rtl/g) || []).length;
    const ltrContactRuns = (documentXml.match(/<w:lang w:val="en-US"/g) || []).length;

    assert.ok(bidiParagraphs >= 8, 'CV paragraphs should include RTL bidi markers');
    assert.ok(rtlRuns >= 8, 'Hebrew CV runs should include RTL markers');
    assert.ok(ltrContactRuns >= 2, 'CV contact/link runs should preserve standalone LTR strings');
    assert.ok(documentXml.includes('linkedin.com/in/noamnaumovsky'));
    assert.ok(documentXml.includes('github.com/endlessblink'));
  });

  it('generates a non-empty CV from visible form fields when cvData is missing', async () => {
    const buffer = await generateDocument({
      documentType: 'cv',
      clientName: '',
      projectDescription: 'יוצר תוכן AI ומפתח כלים',
      serviceDetails: 'תקציר מקצועי מתוך שדה פירוט השירות.',
      timeline: '2023 - היום: פיתוח כלי AI\n2020 - 2023: עריכת וידאו',
      notes: 'זמין לפרויקטים עצמאיים',
      userProfile: {
        nameEn: 'Noam Naumovsky',
        name: 'נועם נאומובסקי',
        title: 'יוצר תוכן דיגיטלי',
        email: 'noam@example.com',
        phone: '050-1234567',
        website: 'noamn.com',
        language: 'he',
      },
    });

    const extracted = await mammoth.extractRawText({ buffer });
    assert.ok(extracted.value.includes('Noam Naumovsky'));
    assert.ok(extracted.value.includes('noam@example.com'));
    assert.ok(extracted.value.includes('050-1234567'));
    assert.ok(extracted.value.includes('noamn.com'));
    assert.ok(extracted.value.includes('תקציר מקצועי מתוך שדה פירוט השירות'));
    assert.ok(extracted.value.includes('ניסיון / ציר זמן'));
    assert.ok(extracted.value.includes('פיתוח כלי AI'));
  });
});
