import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  BorderStyle,
  Footer,
  ImageRun,
  convertInchesToTwip,
  AlignmentType,
  VerticalAlign,
  TableLayoutType,
  LevelFormat,
} from "docx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IS_PKG, resolveData } from "./app-paths.mjs";
import { processDocData } from "./shared/doc-skills/index.mjs";
import { resolveClauses, getCategoryTexts } from "./shared/clause-resolver.mjs";

// ─── Constants ───────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_DIR = path.resolve(__dirname, "..");
const DEFAULT_LOGO_PATH = path.join(PROJECT_DIR, "assets", "logo.png");

// Read intrinsic pixel dimensions from a PNG or JPEG buffer (no deps).
// Returns { width, height } or null if it can't be parsed.
export function readImageSize(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG: 8-byte signature, then IHDR with width@16 / height@20 (big-endian)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: scan SOFn markers for height/width
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1];
      // SOF0..SOF15 (excluding DHT/DRI/etc.) carry frame dimensions
      if (marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
  }
  return null;
}

// Scale image dimensions to fit within a square box while preserving aspect ratio.
export function fitLogo(buf, box) {
  const size = readImageSize(buf);
  if (!size || !size.width || !size.height) return { width: box, height: box };
  const scale = Math.min(box / size.width, box / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

const FONT = "Heebo";
const FONT_OBJ = { ascii: FONT, cs: FONT, eastAsia: FONT, hAnsi: FONT };

const BODY_SIZE = "11pt";
const SMALL_SIZE = "9pt";

const LIGHT_BLUE = "D6E4F0";
const LIGHT_GRAY_BORDER = "BFBFBF";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create an RTL TextRun with consistent defaults. */
function rtlRun(text, opts = {}) {
  return new TextRun({
    text,
    rightToLeft: true,
    font: FONT_OBJ,
    size: BODY_SIZE,
    language: { value: "he-IL", bidirectional: "he-IL" },
    ...opts,
  });
}

/** Create an RTL paragraph with consistent defaults. */
function rtlParagraph(children, opts = {}) {
  const childArray = Array.isArray(children) ? children : [children];
  return new Paragraph({
    bidirectional: true,
    children: childArray,
    spacing: { after: 120 },
    ...opts,
  });
}

/** Create a section header as a shaded paragraph matching reference style. */
function sectionHeader(text) {
  return new Paragraph({
    bidirectional: true,
    spacing: { before: 360, after: 200 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: LIGHT_BLUE },
    border: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "9BB7D6", space: 4 },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "9BB7D6", space: 4 },
    },
    children: [
      rtlRun(text, {
        bold: true,
        boldComplexScript: true,
        size: "14pt",
        sizeComplexScript: "14pt",
      }),
    ],
  });
}

/** Standard thin gray border definition */
const thinBorder = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: LIGHT_GRAY_BORDER,
};

const cellBorders = {
  top: thinBorder,
  bottom: thinBorder,
  left: thinBorder,
  right: thinBorder,
};

const noBorders = {
  top: { style: BorderStyle.NONE },
  bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE },
};

/** Create a table cell with RTL paragraph */
function makeCell(text, opts = {}) {
  const { bold, shading, width, columnSpan, alignment } = opts;
  const cellOpts = {
    children: [
      rtlParagraph(
        [rtlRun(text, {
          bold: bold || false,
          boldComplexScript: bold || false,
        })],
        alignment ? { alignment } : {}
      ),
    ],
    borders: cellBorders,
    verticalAlign: VerticalAlign.CENTER,
  };
  if (shading) cellOpts.shading = shading;
  if (width) cellOpts.width = width;
  if (columnSpan) cellOpts.columnSpan = columnSpan;
  return new TableCell(cellOpts);
}

/**
 * Get direction-aware helpers based on language.
 * @param {string} language - 'he' for RTL Hebrew, 'en' for LTR English
 */
function getDirectionHelpers(language = 'he') {
  const isRTL = language === 'he';
  const lang = isRTL ? { value: 'he-IL', bidirectional: 'he-IL' } : { value: 'en-US' };

  function dirRun(text, opts = {}) {
    return new TextRun({
      text,
      rightToLeft: isRTL,
      font: FONT_OBJ,
      size: BODY_SIZE,
      language: lang,
      ...opts,
    });
  }

  function dirParagraph(children, opts = {}) {
    const childArray = Array.isArray(children) ? children : [children];
    return new Paragraph({
      bidirectional: isRTL,
      children: childArray,
      spacing: { after: 120 },
      ...opts,
    });
  }

  return { isRTL, dirRun, dirParagraph };
}

/** Strip any leading bullet/dash characters from text */
function stripBullet(text) {
  return text.replace(/^[\u2022\u2023\u2043\u25E6•·‣\-–—]\s*/, '').trim();
}

function ltrRun(text, opts = {}) {
  return new TextRun({
    text,
    rightToLeft: false,
    font: FONT_OBJ,
    size: BODY_SIZE,
    language: { value: 'en-US' },
    ...opts,
  });
}

/** Create a bullet-style paragraph using native DOCX numbering */
function dashParagraph(text) {
  return new Paragraph({
    bidirectional: true,
    bidi: true,
    spacing: { after: 80 },
    alignment: AlignmentType.BOTH,
    numbering: { reference: "bullet-list", level: 0 },
    children: [rtlRun(stripBullet(text))],
  });
}

/**
 * Render a clause section: a shaded header followed by its clause texts.
 * Returns an array of paragraphs (empty if there are no texts, so the header
 * is never emitted for an empty section).
 *
 * @param {string} headerText
 * @param {string[]} texts
 * @param {'bullets'|'prose'} [style] - bullets = bulleted list (short clauses);
 *   prose = justified paragraphs (long-form legal clauses)
 */
function clauseBlock(headerText, texts, style = 'bullets') {
  if (!texts || texts.length === 0) return [];
  const out = [sectionHeader(headerText)];
  texts.forEach((text, i) => {
    if (style === 'prose') {
      out.push(rtlParagraph([rtlRun(text)], {
        spacing: { before: i === 0 ? 60 : 0, after: 160 },
        alignment: AlignmentType.BOTH,
      }));
    } else {
      out.push(dashParagraph(text));
    }
  });
  return out;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split('\n').map(v => v.trim()).filter(Boolean);
  return [];
}

function cvSectionHeader(text) {
  return new Paragraph({
    bidirectional: true,
    spacing: { before: 260, after: 120 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '0F6674', space: 4 },
    },
    children: [rtlRun(text, {
      bold: true,
      boldComplexScript: true,
      size: '13pt',
      sizeComplexScript: '13pt',
      color: '0F6674',
    })],
  });
}

function cvRoleParagraph(item) {
  const parts = [item.title, item.organization].filter(Boolean).join(' — ');
  const dates = item.dates || item.date || '';
  const label = dates ? `${parts}   ${dates}` : parts;
  return rtlParagraph([rtlRun(label, {
    bold: true,
    boldComplexScript: true,
    size: '11.5pt',
    sizeComplexScript: '11.5pt',
  })], { spacing: { before: 120, after: 60 } });
}

function buildCvFallbackSections(data) {
  const sections = [];
  const timeline = normalizeArray(data.timeline);
  const notes = normalizeArray(data.notes);

  if (timeline.length > 0) {
    sections.push({ title: 'ניסיון / ציר זמן', items: timeline });
  }
  if (notes.length > 0) {
    sections.push({ title: 'מידע נוסף', items: notes });
  }

  return sections;
}

async function generateCvDocument(data) {
  const cv = data.cvData || {};
  const fullName = cv.fullName || data.clientName || data.userProfile?.nameEn || data.userProfile?.name || 'קורות חיים';
  const headline = cv.headline || data.projectDescription || data.userProfile?.title || '';
  const location = cv.location || '';
  const profile = cv.profile || data.serviceDetails || '';
  const phone = cv.phone || data.userProfile?.phone || '';
  const email = cv.email || data.userProfile?.email || '';
  const website = cv.website || data.userProfile?.website || '';
  const links = Array.isArray(cv.links) ? cv.links : [];
  const sections = normalizeArray(cv.sections);
  const fallbackSections = sections.length > 0 ? [] : buildCvFallbackSections(data);

  const children = [];

  children.push(rtlParagraph([rtlRun(fullName, {
    bold: true,
    boldComplexScript: true,
    size: '26pt',
    sizeComplexScript: '26pt',
    color: '111827',
  })], { alignment: AlignmentType.CENTER, spacing: { after: 40 } }));

  if (headline || location) {
    children.push(rtlParagraph([rtlRun([headline, location].filter(Boolean).join(' · '), {
      size: '12.5pt',
      sizeComplexScript: '12.5pt',
      color: '374151',
    })], { alignment: AlignmentType.CENTER, spacing: { after: 80 } }));
  }

  const contactParts = [phone, email, website, ...links.map(link => link.url ? `${link.label || ''}: ${link.url}`.trim() : link.label).filter(Boolean)];
  if (contactParts.length > 0) {
    const contactRuns = [];
    contactParts.forEach((part, index) => {
      if (index > 0) contactRuns.push(rtlRun('  ·  ', { color: '6B7280' }));
      contactRuns.push(ltrRun(part, { size: '9.5pt', sizeComplexScript: '9.5pt', color: '374151' }));
    });
    children.push(rtlParagraph(contactRuns, { alignment: AlignmentType.CENTER, spacing: { after: 260 } }));
  }

  if (profile) {
    children.push(cvSectionHeader('פרופיל'));
    children.push(rtlParagraph([rtlRun(profile)], { spacing: { after: 120 }, alignment: AlignmentType.BOTH }));
  }

  for (const section of [...sections, ...fallbackSections]) {
    if (!section || !section.title) continue;
    children.push(cvSectionHeader(section.title));
    for (const item of normalizeArray(section.items)) {
      if (typeof item === 'string') {
        children.push(dashParagraph(item));
        continue;
      }
      children.push(cvRoleParagraph(item));
      for (const bullet of normalizeArray(item.bullets || item.details || item.description)) {
        children.push(dashParagraph(bullet));
      }
    }
  }

  const skills = normalizeArray(cv.skills);
  if (skills.length > 0) {
    children.push(cvSectionHeader('כישורים וכלים'));
    for (const skillGroup of skills) {
      if (typeof skillGroup === 'string') {
        children.push(dashParagraph(skillGroup));
        continue;
      }
      const items = normalizeArray(skillGroup.items).join(', ');
      const line = [skillGroup.category, items].filter(Boolean).join(' — ');
      if (line) children.push(dashParagraph(line));
    }
  }

  const languages = normalizeArray(cv.languages);
  if (languages.length > 0) {
    children.push(cvSectionHeader('שפות'));
    languages.forEach(language => children.push(dashParagraph(language)));
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullet-list',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '\u2022',
          alignment: AlignmentType.RIGHT,
          style: {
            paragraph: { indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.18) } },
            run: { font: FONT_OBJ },
          },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: {
            font: FONT_OBJ,
            size: BODY_SIZE,
            rightToLeft: true,
            language: { value: 'he-IL', bidirectional: 'he-IL' },
          },
          paragraph: { bidirectional: true },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.55),
            bottom: convertInchesToTwip(0.6),
            left: convertInchesToTwip(0.7),
            right: convertInchesToTwip(0.7),
          },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

// ─── Document Builder ─────────────────────────────────────────────────────────

/**
 * Generate a DOCX document from the provided data.
 * @param {Object} data - Document data
 * @returns {Promise<Buffer>} DOCX file as a Buffer
 */
export async function generateDocument(data) {
  // Resolve the clauses database BEFORE the doc-skills pipeline so skills
  // (e.g. dedupe-notes) can reconcile notes against the resolved clauses.
  // CRITICAL: this MUST be the same DB the server/UI use to build the clause
  // selector and the selectedClauses whitelist — otherwise clause IDs won't
  // match and every selected clause gets filtered out. Prefer a DB the caller
  // passed in (server passes its loaded clausesDb), then the active user-data
  // DB (resolveData), and only then the bundled copy as a last resort.
  let clausesDb = data._clausesDb || null;
  if (!clausesDb) {
    const candidates = [
      path.join(PROJECT_DIR, 'knowledge', 'clauses-db.json'),
      resolveData('knowledge', 'clauses-db.json'),
    ];
    for (const dbPath of candidates) {
      try { clausesDb = JSON.parse(fs.readFileSync(dbPath, 'utf-8')); break; } catch { /* try next */ }
    }
  }
  data._clausesDb = clausesDb;

  // Run doc-skills pipeline to clean/transform data before rendering
  processDocData(data);

  if (data.documentType === 'cv') {
    return generateCvDocument(data);
  }

  const {
    clientName = "",
    clientCompany = "",
    documentType = "quote",
    projectDescription = "",
    serviceDetails = "",
    pricingItems = [],
    paymentTerms = { type: "two", installments: [] },
    timeline = "",
    generalNotes = "",
    date = null,
    serviceType = "",
    selectedClauses = null,
    clauseEdits = {},
    userProfile = {},
  } = data;

  const language = userProfile.language || 'he';

  // clausesDb was loaded at the top of generateDocument (before the doc-skills
  // pipeline) and attached as data._clausesDb.

  // Resolve the effective clauses once via the shared resolver.
  const resolvedClauses = resolveClauses(clausesDb, {
    documentType, serviceType, selectedClauses, clauseEdits, language,
  });
  const getClauseTexts = (categoryKey) => getCategoryTexts(resolvedClauses, categoryKey);

  const logoPath = userProfile.logoPath
    ? (path.isAbsolute(userProfile.logoPath) ? userProfile.logoPath : path.join(PROJECT_DIR, 'data', userProfile.logoPath))
    : DEFAULT_LOGO_PATH;
  let logoBuffer;
  try {
    logoBuffer = fs.readFileSync(logoPath);
  } catch {
    logoBuffer = fs.existsSync(DEFAULT_LOGO_PATH) ? fs.readFileSync(DEFAULT_LOGO_PATH) : null;
  }
  const fromToCellShading = { type: ShadingType.CLEAR, color: "auto", fill: LIGHT_BLUE };

  // ── Document title based on type ──
  const titleMap = {
    quote: "הצעת מחיר",
    contract: "חוזה עבודה",
    workOrder: "הזמנת עבודה",
    cv: "קורות חיים",
  };
  const docTitle = titleMap[documentType] || "הצעת מחיר";

  // ── Date ──
  const today = date || new Date().toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" });

  // ── FROM/TO Table ──
  const fromToTable = new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          makeCell(`מאת: ${userProfile.nameEn || userProfile.name || ''}`, { bold: true, shading: fromToCellShading, width: { size: 50, type: WidthType.PERCENTAGE } }),
          makeCell(`לכבוד: ${clientName}`, { bold: true, shading: fromToCellShading, width: { size: 50, type: WidthType.PERCENTAGE } }),
        ],
      }),
      new TableRow({
        children: [
          makeCell(userProfile.company || '', { shading: fromToCellShading, width: { size: 50, type: WidthType.PERCENTAGE } }),
          makeCell(clientCompany || "", { shading: fromToCellShading, width: { size: 50, type: WidthType.PERCENTAGE } }),
        ],
      }),
    ],
  });

  // ── Pricing Table ──
  const pricingHeaderShading = { type: ShadingType.CLEAR, color: "auto", fill: LIGHT_BLUE };

  const formatPrice = (n) => n.toLocaleString("he-IL") + " ₪";

  /** Build item rows for an array of pricing items */
  function buildPricingRows(items) {
    return items.map((item) => {
      const total = (item.quantity || 1) * (item.unitPrice || 0);
      return new TableRow({
        children: [
          makeCell(item.description || "", { width: { size: 45, type: WidthType.PERCENTAGE } }),
          makeCell(String(item.quantity || 1), { width: { size: 15, type: WidthType.PERCENTAGE } }),
          makeCell(formatPrice(item.unitPrice || 0), { width: { size: 20, type: WidthType.PERCENTAGE } }),
          makeCell(formatPrice(total), { width: { size: 20, type: WidthType.PERCENTAGE } }),
        ],
      });
    });
  }

  /** Build a complete pricing table (header + rows + total row) */
  function buildPricingTable(items) {
    const subtotal = items.reduce((sum, item) => sum + (item.quantity || 1) * (item.unitPrice || 0), 0);
    return new Table({
      visuallyRightToLeft: true,
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      columnWidths: [4500, 1500, 2000, 2000],
      rows: [
        new TableRow({
          children: [
            makeCell("פירוט", { bold: true, shading: pricingHeaderShading, width: { size: 45, type: WidthType.PERCENTAGE } }),
            makeCell("כמות", { bold: true, shading: pricingHeaderShading, width: { size: 15, type: WidthType.PERCENTAGE } }),
            makeCell("מחיר ליחידה", { bold: true, shading: pricingHeaderShading, width: { size: 20, type: WidthType.PERCENTAGE } }),
            makeCell('סה"כ', { bold: true, shading: pricingHeaderShading, width: { size: 20, type: WidthType.PERCENTAGE } }),
          ],
        }),
        ...buildPricingRows(items),
        new TableRow({
          children: [
            makeCell("", { width: { size: 45, type: WidthType.PERCENTAGE } }),
            makeCell("", { width: { size: 15, type: WidthType.PERCENTAGE } }),
            makeCell('סה"כ לפני מע"מ', { bold: true, shading: pricingHeaderShading, width: { size: 20, type: WidthType.PERCENTAGE } }),
            makeCell(formatPrice(subtotal), { bold: true, shading: pricingHeaderShading, width: { size: 20, type: WidthType.PERCENTAGE } }),
          ],
        }),
      ],
    });
  }

  // Detect whether any items carry an option field
  const hasOptions = pricingItems.some(item => item.option != null && String(item.option).trim() !== "");

  // For single-table path: calculate total for use in payment terms section below
  const totalBeforeVat = hasOptions
    ? 0  // not used when options are present
    : pricingItems.reduce((sum, item) => sum + (item.quantity || 1) * (item.unitPrice || 0), 0);

  // Pre-build option groups (used further down in the body-children section)
  let sharedItems = [];
  let optionGroups = {}; // { "1": [...], "2": [...] }
  if (hasOptions) {
    for (const item of pricingItems) {
      const opt = item.option != null ? String(item.option).trim() : "";
      if (opt === "") {
        sharedItems.push(item);
      } else {
        if (!optionGroups[opt]) optionGroups[opt] = [];
        optionGroups[opt].push(item);
      }
    }
  }

  // Single-table (no options) — built once here for use in the body section
  const pricingTable = hasOptions ? null : buildPricingTable(pricingItems);

  // ── Signature Section ──
  function signatureCell(label) {
    return new TableCell({
      width: { size: 33, type: WidthType.PERCENTAGE },
      borders: noBorders,
      verticalAlign: VerticalAlign.BOTTOM,
      children: [
        rtlParagraph([rtlRun("_________________")], { spacing: { after: 40 }, alignment: AlignmentType.CENTER }),
        rtlParagraph([rtlRun(label, { size: "10pt", sizeComplexScript: "10pt" })], { spacing: { after: 0 }, alignment: AlignmentType.CENTER }),
      ],
    });
  }

  function signatureRow(col1, col2, col3) {
    return new TableRow({
      children: [signatureCell(col1), signatureCell(col2), signatureCell(col3)],
    });
  }

  const signatureTitle = rtlParagraph(
    [rtlRun("חתימה על מסמך זה מהווה אישור והתחייבות לכל הרשום לעיל", {
      bold: true, boldComplexScript: true,
      size: "11pt", sizeComplexScript: "11pt",
    })],
    { spacing: { before: 400, after: 300 }, alignment: AlignmentType.CENTER }
  );

  const signatureTable = new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      signatureRow("שם הלקוח", "חתימה וחותמת", "תאריך"),
      new TableRow({
        children: [
          new TableCell({ borders: noBorders, children: [rtlParagraph([rtlRun("")], { spacing: { after: 200 } })] }),
          new TableCell({ borders: noBorders, children: [rtlParagraph([rtlRun("")], { spacing: { after: 200 } })] }),
          new TableCell({ borders: noBorders, children: [rtlParagraph([rtlRun("")], { spacing: { after: 200 } })] }),
        ],
      }),
      signatureRow("שם מבצע העבודה", "חתימה וחותמת", "תאריך"),
    ],
  });

  // ── Footer ──
  const footerTable = new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: LIGHT_GRAY_BORDER },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            borders: noBorders,
            children: [
              new Paragraph({
                bidirectional: true,
                children: logoBuffer ? [
                  new ImageRun({
                    data: logoBuffer,
                    transformation: fitLogo(logoBuffer, 80),
                    type: "png",
                  }),
                ] : [],
              }),
            ],
          }),
          new TableCell({
            width: { size: 80, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            borders: noBorders,
            children: [
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.LEFT,
                spacing: { after: 0 },
                children: [rtlRun(userProfile.name || '', { bold: true, boldComplexScript: true, size: SMALL_SIZE, sizeComplexScript: SMALL_SIZE })],
              }),
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.LEFT,
                spacing: { after: 0 },
                children: [rtlRun(userProfile.title || '', { size: SMALL_SIZE, sizeComplexScript: SMALL_SIZE })],
              }),
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.LEFT,
                spacing: { after: 0 },
                children: [new TextRun({ text: [userProfile.email, userProfile.website].filter(Boolean).join(' | '), font: FONT_OBJ, size: SMALL_SIZE, sizeComplexScript: SMALL_SIZE, rightToLeft: false })],
              }),
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.LEFT,
                spacing: { after: 0 },
                children: [new TextRun({ text: userProfile.phone || '', font: FONT_OBJ, size: SMALL_SIZE, sizeComplexScript: SMALL_SIZE, rightToLeft: false })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const footer = new Footer({ children: [footerTable] });

  // ── Build body children ──
  const bodyChildren = [
    // Date
    rtlParagraph(
      [rtlRun(`תאריך ${today}`, { size: "11pt", sizeComplexScript: "11pt" })],
      { spacing: { after: 60 } }
    ),

    // Title
    rtlParagraph(
      [rtlRun(`${docTitle} –`, {
        bold: true, boldComplexScript: true,
        size: "22pt", sizeComplexScript: "22pt",
      })],
      { spacing: { after: 60 }, alignment: AlignmentType.CENTER }
    ),

    // Subtitle (project description)
    rtlParagraph(
      [rtlRun(projectDescription, { size: "13pt", sizeComplexScript: "13pt" })],
      { spacing: { after: 300 }, alignment: AlignmentType.CENTER }
    ),

    // FROM/TO
    fromToTable,
    rtlParagraph([rtlRun("")], { spacing: { after: 40 } }),
  ];

  // Service details section
  if (serviceDetails) {
    bodyChildren.push(sectionHeader("פירוט השירות"));
    const lines = serviceDetails.split("\n").filter(l => l.trim());

    // Parse lines into options and plain text
    const options = [];
    const plainLines = [];
    let currentOpt = null;

    for (const line of lines) {
      const optMatch = line.match(/^אופציה\s*(\d+)\s*[–—\-:]\s*(.*)/);
      if (optMatch) {
        // Strip repeated "אופציה X – " from the title if present
        let title = optMatch[2].trim();
        title = title.replace(/^אופציה\s*\d+\s*[–—\-:]\s*/, '').trim();
        // If title contains multiple sentences, first is title, rest are details
        const titleSentences = title.split(/(?<=\.)\s+/).filter(s => s.trim());
        const mainTitle = titleSentences[0] || title;
        const extraDetails = titleSentences.slice(1);
        currentOpt = { label: `אופציה ${optMatch[1]}`, title: mainTitle, details: [...extraDetails] };
        options.push(currentOpt);
      } else if (currentOpt) {
        // Split long lines by sentence into separate detail bullets
        const cleaned = line.replace(/^[•\-]\s*/, '');
        const sentences = cleaned.split(/(?<=\.)\s+/).filter(s => s.trim());
        if (sentences.length > 1) {
          sentences.forEach(s => currentOpt.details.push(s.trim()));
        } else {
          currentOpt.details.push(cleaned);
        }
      } else {
        plainLines.push(line);
      }
    }

    // Render plain lines first (skip meta-sentences about options when options table follows)
    for (const line of plainLines) {
      if (options.length > 0 && /אופציו?ת.*לבחירה|יש לבחור/i.test(line)) continue;
      if (line.startsWith("•") || line.startsWith("-")) {
        bodyChildren.push(dashParagraph(line.replace(/^[•\-]\s*/, "")));
      } else {
        bodyChildren.push(rtlParagraph([rtlRun(line)], { spacing: { after: 80 } }));
      }
    }

    // Render options as a table
    if (options.length > 0) {
      const optHeaderShading = { type: ShadingType.CLEAR, color: "auto", fill: LIGHT_BLUE };
      const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };
      const optRows = [
        new TableRow({
          tableHeader: true,
          children: [
            new TableCell({
              width: { size: 20, type: WidthType.PERCENTAGE },
              borders: cellBorders,
              verticalAlign: VerticalAlign.CENTER,
              margins: cellMargins,
              shading: optHeaderShading,
              children: [rtlParagraph([rtlRun("אופציה", { bold: true, boldComplexScript: true })])],
            }),
            new TableCell({
              width: { size: 80, type: WidthType.PERCENTAGE },
              borders: cellBorders,
              verticalAlign: VerticalAlign.CENTER,
              margins: cellMargins,
              shading: optHeaderShading,
              children: [rtlParagraph([rtlRun("פירוט", { bold: true, boldComplexScript: true })])],
            }),
          ],
        }),
      ];

      for (const opt of options) {
        const descParagraphs = [];
        if (opt.title) {
          descParagraphs.push(rtlParagraph(
            [rtlRun(opt.title, { bold: true, boldComplexScript: true })],
            { spacing: { after: 100 } }
          ));
        }
        opt.details.forEach((detail, di) => {
          descParagraphs.push(rtlParagraph(
            [rtlRun(detail)],
            { spacing: { before: di === 0 ? 40 : 0, after: 80 }, numbering: { reference: "bullet-list", level: 0 } }
          ));
        });
        if (descParagraphs.length === 0) {
          descParagraphs.push(rtlParagraph([rtlRun('')]));
        }

        optRows.push(new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 20, type: WidthType.PERCENTAGE },
              borders: cellBorders,
              verticalAlign: VerticalAlign.CENTER,
              margins: cellMargins,
              children: [rtlParagraph([rtlRun(opt.label, { bold: true, boldComplexScript: true })])],
            }),
            new TableCell({
              width: { size: 80, type: WidthType.PERCENTAGE },
              borders: cellBorders,
              verticalAlign: VerticalAlign.TOP,
              margins: cellMargins,
              children: descParagraphs,
            }),
          ],
        }));
      }

      bodyChildren.push(new Table({
        rows: optRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        columnWidths: [2000, 8000],
        visuallyRightToLeft: true,
      }));
    }

    bodyChildren.push(rtlParagraph([rtlRun("")], { spacing: { after: 40 } }));
  }

  // Pricing section
  if (pricingItems.length > 0) {
    bodyChildren.push(sectionHeader("עלות"));

    if (hasOptions) {
      // Shared (non-option) items first, if any
      if (sharedItems.length > 0) {
        bodyChildren.push(buildPricingTable(sharedItems));
        bodyChildren.push(rtlParagraph([rtlRun("")], { spacing: { after: 40 } }));
      }

      // One section per option
      for (const [optKey, optItems] of Object.entries(optionGroups)) {
        // Use the first item's description as subtitle if available
        const firstDesc = optItems[0] && optItems[0].description ? optItems[0].description : "";
        const optionLabel = firstDesc
          ? `אופציה ${optKey} — ${firstDesc}`
          : `אופציה ${optKey}`;

        bodyChildren.push(
          new Paragraph({
            bidirectional: true,
            spacing: { before: 200, after: 120 },
            children: [
              rtlRun(optionLabel, {
                bold: true,
                boldComplexScript: true,
                size: "12pt",
                sizeComplexScript: "12pt",
              }),
            ],
          })
        );

        // Include shared items in this option's table so the subtotal is complete
        const tableItems = [...sharedItems, ...optItems];
        bodyChildren.push(buildPricingTable(tableItems));
        bodyChildren.push(rtlParagraph([rtlRun("")], { spacing: { after: 40 } }));
      }
    } else {
      bodyChildren.push(pricingTable);
    }
  }

  // Payment terms section
  if (paymentTerms && paymentTerms.installments && paymentTerms.installments.length > 0) {
    bodyChildren.push(sectionHeader("תמורה ותנאי תשלום"));

    // Compute totals for amount display
    const paymentTotals = [];
    if (hasOptions) {
      for (const [optKey, optItems] of Object.entries(optionGroups)) {
        const shared = sharedItems.reduce((s, i) => s + (i.quantity || 1) * (i.unitPrice || 0), 0);
        const optTotal = optItems.reduce((s, i) => s + (i.quantity || 1) * (i.unitPrice || 0), 0) + shared;
        paymentTotals.push({ label: `אופציה ${optKey}`, total: optTotal });
      }
    } else if (totalBeforeVat > 0) {
      paymentTotals.push({ label: null, total: totalBeforeVat });
    }

    // Build installments as a table (side by side)
    const installs = paymentTerms.installments;
    const colWidth = Math.floor(100 / Math.max(installs.length, 1));

    // For each total (per option or single), render a payment table
    const totalsToShow = paymentTotals.length > 0 ? paymentTotals : [{ label: null, total: 0 }];

    for (const pt of totalsToShow) {
      if (pt.label && paymentTotals.length > 1) {
        bodyChildren.push(rtlParagraph(
          [rtlRun(pt.label, { bold: true, boldComplexScript: true })],
          { spacing: { before: 160, after: 80 } }
        ));
      }

      // Installment cells
      const cells = installs.map(inst => {
        const pct = inst.percentage;
        const amount = pt.total > 0 ? Math.round(pt.total * pct / 100) : 0;
        const amountStr = amount > 0 ? ` בסך של ${formatPrice(amount)} + מע"מ` : '';
        const text = `${inst.description} – ${pct}%${amountStr}`;

        return new TableCell({
          width: { size: colWidth, type: WidthType.PERCENTAGE },
          borders: cellBorders,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [
            new Paragraph({
              bidirectional: true,
              numbering: { reference: "bullet-list", level: 0 },
              children: [rtlRun(text)],
            }),
          ],
        });
      });

      bodyChildren.push(new Table({
        rows: [new TableRow({ children: cells })],
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        visuallyRightToLeft: true,
      }));

      // Totals already shown in pricing tables — no duplication needed
    }

    // Add payment clauses for any doc type (filtered by appliesTo in the resolver).
    // Notes are reconciled against clauses by the dedupe-notes doc-skill, so no
    // per-clause dedup hack is needed here.
    if (clausesDb) {
      const paymentClauses = getClauseTexts('paymentTerms');
      paymentClauses.forEach(text => bodyChildren.push(dashParagraph(text)));
    }
    const invoiceClauseSelected = selectedClauses && selectedClauses.includes('payment-invoice');
    if (!invoiceClauseSelected) {
      bodyChildren.push(dashParagraph('לאחר קבלת התשלום המלא תישלח חשבונית מס.'));
    }
  }

  // Timeline section
  if (timeline) {
    bodyChildren.push(sectionHeader("לוחות זמנים"));
    const timelineLines = timeline.split("\n").filter(l => l.trim());
    for (const line of timelineLines) {
      bodyChildren.push(dashParagraph(line.replace(/^[•\-]\s*/, "")));
    }
  }

  // ── Legal / terms clause sections ──
  // Each section renders iff its category yields clauses for the current doc
  // type. getClauseTexts filters by appliesTo, so quotes get their quote-only
  // clauses (validity, VAT exclusion, …) and contract-only categories stay
  // hidden on quotes via the empty-array guard inside clauseBlock.
  // Short-list clauses use bulleted style; long-form legal clauses use prose.
  bodyChildren.push(...clauseBlock('התחייבויות הלקוח', getClauseTexts('clientObligations'), 'bullets'));
  bodyChildren.push(...clauseBlock('הפסקת עבודה מוקדמת', getClauseTexts('earlyTermination'), 'bullets'));
  bodyChildren.push(...clauseBlock('תיקונים והערות', getClauseTexts('revisions'), 'bullets'));
  bodyChildren.push(...clauseBlock('תהליך סיום ומסירה', getClauseTexts('deliveryProcess'), 'bullets'));
  bodyChildren.push(...clauseBlock('קניין רוחני, רישוי ואחריות', getClauseTexts('intellectualProperty'), 'prose'));
  bodyChildren.push(...clauseBlock('הצהרות לקוח (AI גנרטיבי)', getClauseTexts('aiDisclaimers'), 'prose'));
  bodyChildren.push(...clauseBlock('הגדרת "סיום" ותקופת אחריות', getClauseTexts('warrantyAndCompletion'), 'prose'));
  bodyChildren.push(...clauseBlock('אחריות לשימוש מסחרי', getClauseTexts('commercialResponsibility'), 'prose'));
  bodyChildren.push(...clauseBlock('סודיות', getClauseTexts('confidentiality'), 'prose'));
  bodyChildren.push(...clauseBlock('סיום הפרויקט', getClauseTexts('projectTermination'), 'bullets'));
  bodyChildren.push(...clauseBlock('תנאים כלליים', getClauseTexts('generalTerms'), 'prose'));

  // General notes section (project-specific remarks only — legal/terms content
  // lives in the clause sections; the dedupe-notes skill strips any note line
  // that duplicates a clause, which can leave notes empty).
  if (generalNotes) {
    let noteLines = generalNotes.split("\n").filter(l => l.trim());
    // If all notes are on one line, split by period/sentence
    if (noteLines.length === 1 && noteLines[0].includes('. ')) {
      noteLines = noteLines[0].split(/\.\s+/).filter(l => l.trim()).map(l => l.endsWith('.') ? l : l + '.');
    }
    if (noteLines.length > 0) {
      bodyChildren.push(sectionHeader("הערות כלליות"));
      for (const line of noteLines) {
        bodyChildren.push(dashParagraph(line.replace(/^[•\-]\s*/, "")));
      }
    }
  }

  // Signature — controlled by doctype-sections skill (_sectionFlags.showSignature)
  const showSignature = data._sectionFlags?.showSignature !== false
    ? (documentType === 'contract' || documentType === 'workOrder')  // fallback if skill didn't run
    : data._sectionFlags.showSignature;
  if (showSignature) {
    const signatureBindingInTerms = selectedClauses && selectedClauses.includes('general-signature-binding');
    if (!signatureBindingInTerms) {
      bodyChildren.push(signatureTitle);
    }
    bodyChildren.push(signatureTable);
  }

  // ── Build Document ──
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullet-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.RIGHT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) },
                },
                run: { font: FONT_OBJ },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: {
            font: FONT_OBJ,
            size: BODY_SIZE,
            rightToLeft: true,
            language: { value: "he-IL", bidirectional: "he-IL" },
          },
          paragraph: { bidirectional: true },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(0.9),
              right: convertInchesToTwip(0.9),
            },
          },
        },
        footers: { default: footer },
        children: bodyChildren,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

async function main() {
  const OUTPUT_PATH = IS_PKG
    ? resolveData("output", "sample_quote.docx")
    : path.join(PROJECT_DIR, "output", "sample_quote.docx");

  const defaultData = {
    clientName: "לקוח לדוגמה",
    clientCompany: "חברה לדוגמה בע\"מ",
    documentType: "quote",
    projectDescription: "פרויקט לדוגמה",
    serviceDetails: "שירות לדוגמה — ערוך את הנתונים האלה לפי הצורך.",
    pricingItems: [
      { description: "שירות לדוגמה", quantity: 1, unitPrice: 1000 },
    ],
    paymentTerms: {
      type: "two",
      installments: [
        { percentage: 35, description: "מקדמה בתחילת עבודה" },
        { percentage: 65, description: "יתרת התשלום בסיום" },
      ],
    },
    timeline: "לפי סיכום עם הלקוח.",
    generalNotes: `ההצעה בתוקף ל-30 יום מתאריך הנפקתה.\nהמחיר אינו כולל מע"מ.`,
    date: new Date().toLocaleDateString('he-IL'),
    userProfile: {
      name: '',
      nameEn: '',
      company: '',
      title: '',
      email: '',
      website: '',
      phone: '',
      logoPath: '',
    },
  };

  const buffer = await generateDocument(defaultData);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, buffer);
  console.log(`Document generated successfully: ${OUTPUT_PATH}`);
}

// Run only when executed directly (not imported as module)
if (!IS_PKG && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Error generating document:", err);
    process.exit(1);
  });
}
