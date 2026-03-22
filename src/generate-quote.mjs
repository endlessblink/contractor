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
} from "docx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IS_PKG, resolveData } from "./app-paths.mjs";

// ─── Constants ───────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_DIR = path.resolve(__dirname, "..");
const DEFAULT_LOGO_PATH = path.join(PROJECT_DIR, "assets", "logo.png");

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

/** Create a bullet-style paragraph (with bullet character) */
function bulletParagraph(text) {
  return rtlParagraph([
    rtlRun("• ", {}),
    rtlRun(text),
  ], { spacing: { after: 80 } });
}

/** Create a dash-style paragraph */
function dashParagraph(text) {
  return rtlParagraph([
    rtlRun("• " + text),
  ], { spacing: { after: 80 }, alignment: AlignmentType.BOTH });
}

// ─── Document Builder ─────────────────────────────────────────────────────────

/**
 * Generate a DOCX document from the provided data.
 * @param {Object} data - Document data
 * @returns {Promise<Buffer>} DOCX file as a Buffer
 */
export async function generateDocument(data) {
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

  // Load clauses database for contracts
  let clausesDb = null;
  try {
    const dbPath = path.join(PROJECT_DIR, 'knowledge', 'clauses-db.json');
    clausesDb = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  } catch { /* clauses DB not available */ }

  // Find the service template's relevant clause IDs (if serviceType is provided)
  let relevantClauseIds = null;
  if (serviceType && clausesDb && clausesDb.serviceTemplates) {
    const template = clausesDb.serviceTemplates.find(t => t.type === serviceType);
    if (template && template.relevantClauses) {
      relevantClauseIds = new Set(template.relevantClauses);
    }
  }

  function getClauseTexts(categoryKey) {
    if (!clausesDb || !clausesDb.clauses || !clausesDb.clauses[categoryKey]) return [];
    const docTypeKey = documentType === 'quote' ? 'quote' : documentType === 'contract' ? 'contract' : 'workOrder';
    return clausesDb.clauses[categoryKey].clauses
      .filter(c => {
        // Must apply to this document type
        if (!c.appliesTo.includes(docTypeKey)) return false;
        // If user explicitly selected clauses in the form, use that selection
        if (selectedClauses && Array.isArray(selectedClauses) && selectedClauses.length > 0) {
          return selectedClauses.includes(c.id);
        }
        // If we have a service template, filter by relevant clauses (but always include required ones)
        if (relevantClauseIds) {
          return relevantClauseIds.has(c.id) || c.required;
        }
        // No service template — include all clauses for this doc type
        return true;
      })
      .map(c => {
        const text = clauseEdits[c.id] || c.text;
        // Support bilingual text: { he: "...", en: "..." }
        return typeof text === 'object' ? (text[language] || text.he || text.en || '') : text;
      });
  }

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
                    transformation: { width: 80, height: 80 },
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
    // Split by newlines and create paragraphs
    const lines = serviceDetails.split("\n").filter(l => l.trim());
    for (const line of lines) {
      if (line.startsWith("•") || line.startsWith("-")) {
        bodyChildren.push(dashParagraph(line.replace(/^[•\-]\s*/, "")));
      } else {
        bodyChildren.push(rtlParagraph([rtlRun(line)]));
      }
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
    for (const inst of paymentTerms.installments) {
      const amountStr = totalBeforeVat > 0
        ? ` (${formatPrice(Math.round(totalBeforeVat * inst.percentage / 100))} + מע"מ)`
        : "";
      bodyChildren.push(dashParagraph(`${inst.description} – %${inst.percentage}${amountStr}`));
    }
    // Add contract-specific payment clauses
    if ((documentType === 'contract' || documentType === 'workOrder') && clausesDb) {
      const paymentClauses = getClauseTexts('paymentTerms');
      // Skip the first clause (advance-start) since installments already cover that
      // Add the rest: extra hours, invoice details, no VAT, external costs, infrastructure
      paymentClauses.forEach(text => {
        // Don't duplicate the "no VAT" line if it's in generalNotes
        if (!text.includes('אינו כולל מע"מ') || !generalNotes.includes('מע"מ')) {
          bodyChildren.push(dashParagraph(text));
        }
      });
    }
    // Only add hardcoded invoice line if payment-invoice clause wasn't already included
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

  // ── Contract/Work Order specific sections ──
  if (documentType === 'contract' || documentType === 'workOrder') {
    // Client obligations section
    const clientObligations = getClauseTexts('clientObligations');
    if (clientObligations.length > 0) {
      bodyChildren.push(sectionHeader('התחייבויות הלקוח'));
      clientObligations.forEach(text => bodyChildren.push(dashParagraph(text)));
    }

    // Early termination
    const termination = getClauseTexts('earlyTermination');
    if (termination.length > 0) {
      bodyChildren.push(sectionHeader('הפסקת עבודה מוקדמת'));
      termination.forEach(text => bodyChildren.push(dashParagraph(text)));
    }

    // Revisions policy
    const revisions = getClauseTexts('revisions');
    if (revisions.length > 0) {
      bodyChildren.push(sectionHeader('תיקונים והערות'));
      revisions.forEach(text => bodyChildren.push(dashParagraph(text)));
    }

    // Delivery process
    const delivery = getClauseTexts('deliveryProcess');
    if (delivery.length > 0) {
      bodyChildren.push(sectionHeader('תהליך סיום ומסירה'));
      delivery.forEach(text => bodyChildren.push(dashParagraph(text)));
    }

    // IP, licensing & responsibility
    const ip = getClauseTexts('intellectualProperty');
    if (ip.length > 0) {
      bodyChildren.push(sectionHeader('קניין רוחני, רישוי ואחריות'));
      ip.forEach(text => bodyChildren.push(rtlParagraph([rtlRun(text)], { spacing: { after: 160 }, alignment: AlignmentType.BOTH })));
    }

    // AI disclaimers
    const aiDisclaimers = getClauseTexts('aiDisclaimers');
    if (aiDisclaimers.length > 0) {
      bodyChildren.push(sectionHeader('הצהרות לקוח (AI גנרטיבי)'));
      aiDisclaimers.forEach(text => bodyChildren.push(rtlParagraph([rtlRun(text)], { spacing: { after: 160 }, alignment: AlignmentType.BOTH })));
    }

    // Warranty & completion
    const warranty = getClauseTexts('warrantyAndCompletion');
    if (warranty.length > 0) {
      bodyChildren.push(sectionHeader('הגדרת "סיום" ותקופת אחריות'));
      warranty.forEach(text => bodyChildren.push(rtlParagraph([rtlRun(text)], { spacing: { after: 160 }, alignment: AlignmentType.BOTH })));
    }

    // Commercial responsibility
    const commercial = getClauseTexts('commercialResponsibility');
    if (commercial.length > 0) {
      bodyChildren.push(sectionHeader('אחריות לשימוש מסחרי'));
      commercial.forEach(text => bodyChildren.push(rtlParagraph([rtlRun(text)], { spacing: { after: 160 }, alignment: AlignmentType.BOTH })));
    }

    // Confidentiality
    const confidentiality = getClauseTexts('confidentiality');
    if (confidentiality.length > 0) {
      bodyChildren.push(sectionHeader('סודיות'));
      confidentiality.forEach(text => bodyChildren.push(rtlParagraph([rtlRun(text)], { spacing: { after: 160 }, alignment: AlignmentType.BOTH })));
    }

    // Project termination
    const projectTermination = getClauseTexts('projectTermination');
    if (projectTermination.length > 0) {
      bodyChildren.push(sectionHeader('סיום הפרויקט'));
      projectTermination.forEach(text => bodyChildren.push(dashParagraph(text)));
    }

    // General terms (liability, cancellation, force majeure)
    const generalTerms = getClauseTexts('generalTerms');
    if (generalTerms.length > 0) {
      bodyChildren.push(sectionHeader('תנאים כלליים'));
      generalTerms.forEach(text => bodyChildren.push(rtlParagraph([rtlRun(text)], { spacing: { after: 160 }, alignment: AlignmentType.BOTH })));
    }
  }

  // General notes section
  if (generalNotes) {
    bodyChildren.push(sectionHeader("הערות כלליות"));
    let noteLines = generalNotes.split("\n").filter(l => l.trim());
    // If all notes are on one line, split by period/sentence
    if (noteLines.length === 1 && noteLines[0].includes('. ')) {
      noteLines = noteLines[0].split(/\.\s+/).filter(l => l.trim()).map(l => l.endsWith('.') ? l : l + '.');
    }
    for (const line of noteLines) {
      bodyChildren.push(dashParagraph(line.replace(/^[•\-]\s*/, "")));
    }
  }

  // Signature — skip the title if general-signature-binding was already rendered above
  const signatureBindingInTerms = selectedClauses && selectedClauses.includes('general-signature-binding');
  if (!signatureBindingInTerms) {
    bodyChildren.push(signatureTitle);
  }
  bodyChildren.push(signatureTable);

  // ── Build Document ──
  const doc = new Document({
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
