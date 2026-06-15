import { createHash } from 'node:crypto';

const SECTION_PATTERNS = [
  ['details', /פרטי\s+(?:הפרויקט|ההצעה|המסמך)|מידע\s+כללי/],
  ['description', /תיאור\s+(?:הפרויקט|העבודה)|רקע|מטרת\s+הפרויקט/],
  ['scope', /היקף\s+העבודה|תכולת\s+העבודה|שירותים|תוצרים/],
  ['pricing', /תמחור|מחיר(?:ים)?|עלויות|תמורה/],
  ['timeline', /לוח(?:ות)?\s+זמנים|מועדי\s+מסירה|אבני\s+דרך/],
  ['revisions', /תיקונים|סבבי\s+תיקונים/],
  ['payment', /תנאי\s+תשלום|תשלומים/],
  ['validity', /תוקף(?:\s+ההצעה)?/],
];

const HEBREW_NUMBERS = new Map([
  ['אחד', 1],
  ['אחת', 1],
  ['שני', 2],
  ['שתי', 2],
  ['שניים', 2],
  ['שתיים', 2],
  ['שלושה', 3],
  ['שלוש', 3],
  ['ארבעה', 4],
  ['ארבע', 4],
  ['חמישה', 5],
  ['חמש', 5],
]);

export function normalizeMarkdown(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('Markdown input must be a string');
  }
  return markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function cleanInlineMarkdown(value) {
  return value
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLabel(value) {
  return cleanInlineMarkdown(value)
    .toLowerCase()
    .replace(/[״"'׳']/g, '')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim();
}

function removePlaceholder(value) {
  const cleaned = String(value || '').trim();
  return /^\[[^\]]+\]$/.test(cleaned) ? '' : cleaned;
}

function classifySection(title, level) {
  if (level === 1 && detectMarkdownDocumentType(`# ${title}`)) return 'document_header';
  const normalized = normalizeLabel(title);
  return SECTION_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0] || 'unknown';
}

export function splitMarkdownSections(markdown) {
  const normalized = normalizeMarkdown(markdown);
  const lines = normalized.split('\n');
  const sections = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;

    if (current) {
      current.content = lines.slice(current.contentStart, index).join('\n').trim();
      current.raw = lines.slice(current.startLine - 1, index).join('\n').trim();
      delete current.contentStart;
      sections.push(current);
    }

    const level = match[1].length;
    const title = cleanInlineMarkdown(match[2]);
    current = {
      title,
      level,
      kind: classifySection(title, level),
      startLine: index + 1,
      contentStart: index + 1,
    };
  }

  if (current) {
    current.content = lines.slice(current.contentStart).join('\n').trim();
    current.raw = lines.slice(current.startLine - 1).join('\n').trim();
    delete current.contentStart;
    sections.push(current);
  }

  return sections;
}

export function detectMarkdownDocumentType(markdown) {
  const sample = normalizeLabel(normalizeMarkdown(markdown).slice(0, 2000));
  if (/הזמנת\s+עבודה|הוראת\s+עבודה/.test(sample)) return 'work_order';
  if (/חוזה|הסכם\s+(?:עבודה|שירותים|התקשרות)/.test(sample)) return 'contract';
  if (/הצעת\s+מחיר|הצעה\s+מסחרית/.test(sample)) return 'quote';
  return null;
}

function sectionsOfKind(sections, kind) {
  return sections.filter(section => section.kind === kind);
}

function contentFor(sections, kind) {
  return sectionsOfKind(sections, kind)
    .map(section => section.content)
    .filter(Boolean)
    .join('\n');
}

function plainLines(content) {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('|'))
    .map(cleanInlineMarkdown)
    .filter(Boolean);
}

function extractKeyValue(content, keys) {
  const normalizedKeys = keys.map(normalizeLabel);
  for (const line of content.split('\n')) {
    const cleaned = line.replace(/^\s*[-*+]\s+/, '').trim();
    const match = cleaned.match(/^(?:\*\*)?(.+?):(?:\*\*)?\s*(.+)$/);
    if (!match) continue;
    if (normalizedKeys.includes(normalizeLabel(match[1]))) {
      return cleanInlineMarkdown(match[2]);
    }
  }
  return '';
}

function parseNumber(value) {
  if (!value) return 0;
  const match = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parsePricing(content) {
  const tableRows = content
    .split('\n')
    .filter(line => /^\s*\|.*\|\s*$/.test(line))
    .map(line => line.trim().slice(1, -1).split('|').map(cleanInlineMarkdown));

  if (tableRows.length < 2) return { items: [], total: 0 };

  const headers = tableRows[0].map(normalizeLabel);
  const separatorIndex = tableRows.findIndex((row, index) =>
    index > 0 && row.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, ''))),
  );
  const descriptionIndex = headers.findIndex(header => /רכיב|פריט|פירוט|תיאור|שירות/.test(header));
  const quantityIndex = headers.findIndex(header => /כמות/.test(header));
  const unitPriceIndex = headers.findIndex(header => /מחיר(?:\s+ליחידה|\s+יחידה)?/.test(header));
  const totalIndex = headers.findIndex(header => /סהכ|סך\s+הכל/.test(header));
  const rows = tableRows.slice(separatorIndex >= 0 ? separatorIndex + 1 : 1);
  const items = [];
  let declaredTotal = 0;

  for (const row of rows) {
    const description = cleanInlineMarkdown(row[descriptionIndex >= 0 ? descriptionIndex : 0] || '');
    if (!description) continue;

    if (/סהכ|סך\s+הכל/.test(normalizeLabel(description))) {
      declaredTotal = parseNumber(row[totalIndex >= 0 ? totalIndex : row.length - 1]);
      continue;
    }

    const qty = parseNumber(row[quantityIndex]) || 1;
    const price = parseNumber(row[unitPriceIndex >= 0 ? unitPriceIndex : totalIndex]);
    if (!price) continue;
    items.push({ desc: description, qty, price });
  }

  const calculatedTotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  return { items, total: declaredTotal || calculatedTotal };
}

function parseTimeline(content) {
  const lines = content.split('\n').map(line => {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      return line.trim().slice(1, -1).split('|').map(cleanInlineMarkdown).join(' — ');
    }
    return cleanInlineMarkdown(line);
  }).filter(line => line && !/^-+(?:\s+—\s+-+)+$/.test(line));
  const datePattern = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g;
  const deliveryDates = lines.flatMap(line => line.match(datePattern) || []);
  return { text: lines.join('\n'), deliveryDates };
}

function parseIncludedRounds(text) {
  const match = text.match(/(\d+|אחד|אחת|שני|שתי|שניים|שתיים|שלושה|שלוש|ארבעה|ארבע|חמישה|חמש)(?:\s*\(\d+\))?\s+סבב(?:י|ים)?/);
  if (!match) return null;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : HEBREW_NUMBERS.get(match[1]) || null;
}

function parseRevisions(content) {
  const lines = plainLines(content);
  const includedRounds = parseIncludedRounds(lines.join(' '));
  const extraLine = lines.find(line => /נוס(?:ף|פת|פים|פות)/.test(line) && parseNumber(line));
  const extraPrices = extraLine
    ? [...extraLine.replace(/,/g, '').matchAll(/(\d+(?:\.\d+)?)\s*₪/g)].map(match => Number(match[1]))
    : [];
  return {
    text: lines.join('\n'),
    includedRounds,
    extraRoundPrice: extraPrices.at(-1) || null,
  };
}

function parsePaymentTerms(content) {
  const lines = plainLines(content);
  const installments = lines.flatMap(line => {
    const match = line.match(/(\d{1,3})\s*%/);
    return match ? [{ percentage: Number(match[1]), description: line }] : [];
  });
  const netMatch = lines.join(' ').match(/(?:net|שוטף)\s*\+?\s*(\d{1,3})/i);
  return {
    text: lines.join('\n'),
    installments,
    netDays: netMatch ? Number(netMatch[1]) : null,
  };
}

function parseValidity(content) {
  const match = plainLines(content).join(' ').match(/(\d{1,3})\s*(?:ימי(?:ם)?|יום)/);
  return match ? Number(match[1]) : null;
}

function extractFallbackTitle(sections, documentType) {
  const heading = sections.find(section => section.kind === 'document_header')?.title || '';
  const withoutType = heading
    .replace(/הצעת\s+מחיר|הצעה\s+מסחרית|חוזה(?:\s+למתן\s+שירותים)?|הסכם(?:\s+עבודה)?|הזמנת\s+עבודה/g, '')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '');
  return withoutType || (documentType === 'contract' ? 'חוזה' : documentType === 'work_order' ? 'הזמנת עבודה' : '');
}

function buildWarnings(fields) {
  const warnings = [];
  const definitions = [
    ['recipient', 'missing_recipient', 'לא נמצא נמען במסמך.'],
    ['title', 'missing_title', 'לא נמצאה כותרת פרויקט.'],
    ['description', 'missing_description', 'לא נמצא תיאור פרויקט.'],
    ['scope', 'missing_scope', 'לא נמצא היקף עבודה.'],
    ['pricing', 'missing_pricing', 'לא נמצאו שורות תמחור.'],
    ['timeline', 'missing_timeline', 'לא נמצא לוח זמנים.'],
    ['revisions', 'missing_revisions', 'לא נמצאו תנאי תיקונים.'],
    ['payment', 'missing_payment_terms', 'לא נמצאו תנאי תשלום.'],
    ['validity', 'missing_validity', 'לא נמצא תוקף למסמך.'],
  ];

  for (const [field, code, message] of definitions) {
    if (!fields[field]) warnings.push({ code, field, message });
  }
  return warnings;
}

export function buildSourceMetadata(markdown, options = {}) {
  const normalized = normalizeMarkdown(markdown);
  const sections = splitMarkdownSections(normalized);
  return {
    kind: 'markdown',
    name: options.sourceName || null,
    sha256: createHash('sha256').update(normalized, 'utf8').digest('hex'),
    characterCount: normalized.length,
    lineCount: normalized.split('\n').length,
    headingCount: sections.length,
  };
}

export function parseMarkdownImport(markdown, options = {}) {
  const normalized = normalizeMarkdown(markdown);
  const sections = splitMarkdownSections(normalized);
  const documentType = detectMarkdownDocumentType(normalized) || 'quote';
  const appDocumentType = documentType === 'work_order' ? 'workOrder' : documentType;
  const detailsContent = contentFor(sections, 'details');
  const descriptionContent = contentFor(sections, 'description');
  const headerContent = contentFor(sections, 'document_header');
  const scopeLines = plainLines(contentFor(sections, 'scope'));
  const pricing = parsePricing(contentFor(sections, 'pricing'));
  const timeline = parseTimeline(contentFor(sections, 'timeline'));
  const revisions = parseRevisions(contentFor(sections, 'revisions'));
  const paymentTerms = parsePaymentTerms(contentFor(sections, 'payment'));
  const validityDays = parseValidity(contentFor(sections, 'validity'));
  const title =
    extractKeyValue(detailsContent, ['כותרת', 'שם הפרויקט', 'פרויקט']) ||
    extractFallbackTitle(sections, documentType);
  const recipient = removePlaceholder(
    extractKeyValue(detailsContent, ['לכבוד', 'נמען', 'לקוח', 'עבור']) ||
    extractKeyValue(normalized, ['לכבוד', 'נמען', 'לקוח', 'עבור'])
      .split(/\s+·\s+תאריך:/)[0].trim(),
  );
  const description =
    extractKeyValue(detailsContent, ['תיאור', 'תיאור הפרויקט', 'מטרה']) ||
    plainLines(descriptionContent).join('\n') ||
    plainLines(headerContent).find(line => /^(?:שלום|להלן|הצעה זו)/.test(line)) ||
    '';
  const vatIncluded = !/(?:אינם|אינו|אינה|אינן|לא)\s+כולל(?:ים|ת|ות)?\s+מע[״"']?מ/.test(normalized);
  const paymentPercentages = paymentTerms.installments.map(item => item.percentage);
  const customInstallments = [...paymentPercentages.slice(0, 3)];
  while (customInstallments.length < 3) customInstallments.push(0);

  const notes = [
    revisions.text,
    paymentTerms.text,
    validityDays ? `תוקף: ${validityDays} ימים` : '',
  ].filter(Boolean).join('\n');

  const fieldConfidence = {
    documentType: detectMarkdownDocumentType(normalized) ? 1 : 0.5,
    recipient: recipient ? 1 : 0,
    title: title ? 1 : 0,
    description: description ? 1 : 0,
    scope: scopeLines.length ? 1 : 0,
    pricing: pricing.items.length ? 1 : 0,
    timeline: timeline.text ? 1 : 0,
    revisions: revisions.includedRounds != null ? 1 : revisions.text ? 0.5 : 0,
    payment: paymentTerms.installments.length ? 1 : paymentTerms.text ? 0.5 : 0,
    validity: validityDays != null ? 1 : 0,
  };
  const warningFields = {
    recipient,
    title,
    description,
    scope: scopeLines.length,
    pricing: pricing.items.length,
    timeline: timeline.text,
    revisions: revisions.text,
    payment: paymentTerms.text,
    validity: validityDays,
  };
  const confidenceValues = Object.values(fieldConfidence);
  const overall = Number(
    (confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(2),
  );

  const formData = {
    docType: appDocumentType,
    documentType: appDocumentType,
    clientName: recipient,
    clientCompany: '',
    projectDescription: title || description,
    serviceDetails: scopeLines.join('\n') || description,
    pricingItems: pricing.items,
    total: pricing.total,
    totalBeforeVat: pricing.total,
    paymentStructure: paymentTerms.installments.length ? 'custom' : 'two',
    customInstallments,
    paymentInstallments: paymentTerms.installments,
    paymentNotes: paymentTerms.netDays ? `שוטף + ${paymentTerms.netDays} מקבלת חשבונית` : '',
    paymentTerms: {
      type: paymentTerms.installments.length ? 'custom' : 'two',
      installments: paymentTerms.installments,
      netDays: paymentTerms.netDays,
    },
    timeline: timeline.text,
    notes,
    generalNotes: notes,
    revisions: {
      includedRounds: revisions.includedRounds,
      extraRoundPrice: revisions.extraRoundPrice,
    },
    vatIncluded,
    validityDays,
  };

  return {
    documentType,
    formData,
    extracted: {
      title,
      recipient,
      description,
      scope: scopeLines,
      pricing,
      timeline,
      revisions,
      paymentTerms,
      vatIncluded,
      validityDays,
    },
    unknownSections: sections
      .filter(section => section.kind === 'unknown')
      .map(({ title: sectionTitle, level, content, raw, startLine }) => ({
        title: sectionTitle,
        level,
        content,
        raw,
        startLine,
      })),
    confidence: { overall, fields: fieldConfidence },
    warnings: buildWarnings(warningFields),
    source: buildSourceMetadata(normalized, options),
  };
}

export function parseMarkdownToFormData(markdown, options = {}) {
  return parseMarkdownImport(markdown, options).formData;
}

export const detectDocumentType = detectMarkdownDocumentType;
