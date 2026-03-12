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
  Header,
  Footer,
  ImageRun,
  convertInchesToTwip,
  AlignmentType,
  VerticalAlign,
  TableLayoutType,
  PageNumber,
} from "docx";
import fs from "node:fs";
import path from "node:path";

// ─── Constants ───────────────────────────────────────────────────────────────

const PROJECT_DIR = "/media/endlessblink/data/my-projects/ai-development/freelance/freelance-doc-maker";
const LOGO_PATH = path.join(PROJECT_DIR, "logo-2026_768p.png");
const OUTPUT_PATH = path.join(PROJECT_DIR, "output", "הצעת_מחיר_מירי_פינקו_15_סרטונים.docx");

const FONT = "Heebo";
const FONT_FALLBACK = { ascii: "Arial", cs: FONT, eastAsia: "Arial", hAnsi: "Arial" };
const FONT_OBJ = { ascii: FONT, cs: FONT, eastAsia: FONT, hAnsi: FONT };

const BODY_SIZE = "11pt";
const HEADER_SIZE = "16pt";
const SMALL_SIZE = "9pt";

const LIGHT_BLUE = "D6E4F0";
const LIGHT_GRAY_BORDER = "BFBFBF";
const WHITE = "FFFFFF";

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
    rtlRun("- " + text),
  ], { spacing: { after: 80 }, alignment: AlignmentType.BOTH });
}

// ─── Logo ────────────────────────────────────────────────────────────────────

const logoBuffer = fs.readFileSync(LOGO_PATH);

// ─── Build Document ──────────────────────────────────────────────────────────

// ---------- FROM/TO Table ----------
const fromToCellShading = { type: ShadingType.CLEAR, color: "auto", fill: LIGHT_BLUE };
const fromToTable = new Table({
  visuallyRightToLeft: true,
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({
      children: [
        makeCell("מאת: Noam Naumovsky", { bold: true, shading: fromToCellShading, width: { size: 50, type: WidthType.PERCENTAGE } }),
        makeCell("לכבוד: מירי פינקו", { bold: true, shading: fromToCellShading, width: { size: 50, type: WidthType.PERCENTAGE } }),
      ],
    }),
    new TableRow({
      children: [
        makeCell("Noam Naumovsky Productions", { shading: fromToCellShading, width: { size: 50, type: WidthType.PERCENTAGE } }),
        makeCell("הבית ליוצרי AI מעצבים", { shading: fromToCellShading, width: { size: 50, type: WidthType.PERCENTAGE } }),
      ],
    }),
  ],
});

// ---------- Pricing Table ----------
const pricingHeaderShading = { type: ShadingType.CLEAR, color: "auto", fill: LIGHT_BLUE };

const pricingTable = new Table({
  visuallyRightToLeft: true,
  width: { size: 100, type: WidthType.PERCENTAGE },
  layout: TableLayoutType.FIXED,
  columnWidths: [4500, 1500, 2000, 2000],
  rows: [
    // Header row
    new TableRow({
      children: [
        makeCell("פירוט", { bold: true, shading: pricingHeaderShading, width: { size: 45, type: WidthType.PERCENTAGE } }),
        makeCell("כמות", { bold: true, shading: pricingHeaderShading, width: { size: 15, type: WidthType.PERCENTAGE } }),
        makeCell("מחיר ליחידה", { bold: true, shading: pricingHeaderShading, width: { size: 20, type: WidthType.PERCENTAGE } }),
        makeCell('סה"כ', { bold: true, shading: pricingHeaderShading, width: { size: 20, type: WidthType.PERCENTAGE } }),
      ],
    }),
    // Row 1
    new TableRow({
      children: [
        makeCell("סרטוני הדרכה - שלב א׳", { width: { size: 45, type: WidthType.PERCENTAGE } }),
        makeCell("5", { width: { size: 15, type: WidthType.PERCENTAGE } }),
        makeCell("3,700 ₪", { width: { size: 20, type: WidthType.PERCENTAGE } }),
        makeCell("18,500 ₪", { width: { size: 20, type: WidthType.PERCENTAGE } }),
      ],
    }),
    // Row 2
    new TableRow({
      children: [
        makeCell("סרטוני הדרכה - שלב ב׳", { width: { size: 45, type: WidthType.PERCENTAGE } }),
        makeCell("10", { width: { size: 15, type: WidthType.PERCENTAGE } }),
        makeCell("2,700 ₪", { width: { size: 20, type: WidthType.PERCENTAGE } }),
        makeCell("27,000 ₪", { width: { size: 20, type: WidthType.PERCENTAGE } }),
      ],
    }),
    // Total row
    new TableRow({
      children: [
        makeCell("", { width: { size: 45, type: WidthType.PERCENTAGE } }),
        makeCell("", { width: { size: 15, type: WidthType.PERCENTAGE } }),
        makeCell('סה"כ לפני מע"מ', { bold: true, shading: pricingHeaderShading, width: { size: 20, type: WidthType.PERCENTAGE } }),
        makeCell("45,500 ₪", { bold: true, shading: pricingHeaderShading, width: { size: 20, type: WidthType.PERCENTAGE } }),
      ],
    }),
  ],
});

// ---------- Signature Section ----------
const noBorders = {
  top: { style: BorderStyle.NONE },
  bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE },
};

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
    // Client row
    signatureRow("שם הלקוח", "חתימה וחותמת", "תאריך"),
    // Spacer row
    new TableRow({
      children: [
        new TableCell({ borders: noBorders, children: [rtlParagraph([rtlRun("")], { spacing: { after: 200 } })] }),
        new TableCell({ borders: noBorders, children: [rtlParagraph([rtlRun("")], { spacing: { after: 200 } })] }),
        new TableCell({ borders: noBorders, children: [rtlParagraph([rtlRun("")], { spacing: { after: 200 } })] }),
      ],
    }),
    // Provider row
    signatureRow("שם מבצע העבודה", "חתימה וחותמת", "תאריך"),
  ],
});

// ---------- Footer ----------
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
        // Right side in RTL = logo
        new TableCell({
          width: { size: 20, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
          },
          children: [
            new Paragraph({
              bidirectional: true,
              children: [
                new ImageRun({
                  data: logoBuffer,
                  transformation: { width: 80, height: 80 },
                  type: "png",
                }),
              ],
            }),
          ],
        }),
        // Left side = contact details
        new TableCell({
          width: { size: 80, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
          },
          children: [
            new Paragraph({
              bidirectional: true,
              alignment: AlignmentType.LEFT,
              spacing: { after: 0 },
              children: [
                rtlRun("נועם נאומובסקי", {
                  bold: true,
                  boldComplexScript: true,
                  size: SMALL_SIZE,
                  sizeComplexScript: SMALL_SIZE,
                }),
              ],
            }),
            new Paragraph({
              bidirectional: true,
              alignment: AlignmentType.LEFT,
              spacing: { after: 0 },
              children: [
                rtlRun("יוצר ומפתח עם בינה מלאכותית", { size: SMALL_SIZE, sizeComplexScript: SMALL_SIZE }),
              ],
            }),
            new Paragraph({
              bidirectional: true,
              alignment: AlignmentType.LEFT,
              spacing: { after: 0 },
              children: [
                new TextRun({
                  text: "noamnau@gmail.com | noamn.com",
                  font: FONT_OBJ,
                  size: SMALL_SIZE,
                  sizeComplexScript: SMALL_SIZE,
                  rightToLeft: false,
                }),
              ],
            }),
            new Paragraph({
              bidirectional: true,
              alignment: AlignmentType.LEFT,
              spacing: { after: 0 },
              children: [
                new TextRun({
                  text: "052-6784960",
                  font: FONT_OBJ,
                  size: SMALL_SIZE,
                  sizeComplexScript: SMALL_SIZE,
                  rightToLeft: false,
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
});

const footer = new Footer({
  children: [footerTable],
});

// ---------- Document ----------
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
        paragraph: {
          bidirectional: true,
        },
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
      footers: {
        default: footer,
      },
      children: [
        // ── Date (top-right, above title) ──
        rtlParagraph(
          [rtlRun("תאריך 9.3.26", { size: "11pt", sizeComplexScript: "11pt" })],
          { spacing: { after: 60 } }
        ),

        // ── Title ──
        rtlParagraph(
          [rtlRun("הצעת מחיר –", {
            bold: true,
            boldComplexScript: true,
            size: "22pt",
            sizeComplexScript: "22pt",
          })],
          { spacing: { after: 60 }, alignment: AlignmentType.CENTER }
        ),

        // ── Subtitle ──
        rtlParagraph(
          [rtlRun("הפקת 15 סרטוני הדרכה מבוססי צילומי מסך", {
            size: "13pt",
            sizeComplexScript: "13pt",
          })],
          { spacing: { after: 300 }, alignment: AlignmentType.CENTER }
        ),

        // ── FROM/TO ──
        fromToTable,
        rtlParagraph([rtlRun("")], { spacing: { after: 40 } }),

        // ── פירוט השירות ──

        sectionHeader("פירוט השירות"),
        rtlParagraph([
          rtlRun("הפקת 15 סרטוני הדרכה מבוססי צילומי מסך. הסרטונים יופקו על בסיס חומרים, צילומי מסך וגישה למערכת שיסופקו על ידי הלקוח."),
        ]),
        rtlParagraph([rtlRun("")], { spacing: { after: 40 } }),
        rtlParagraph([rtlRun("היקף העבודה כולל:", { bold: true, boldComplexScript: true })]),
        bulletParagraph("הפקת 5 סרטונים ראשונים בעלות של 3,700 ₪ לסרטון"),
        bulletParagraph("הפקת 10 סרטונים נוספים בעלות של 2,700 ₪ לסרטון"),
        bulletParagraph("כל סרטון כולל 2 סבבי תיקונים"),

        // ── עלות ──

        sectionHeader("עלות"),
        pricingTable,

        // ── תמורה ותנאי תשלום ──

        sectionHeader("תמורה ותנאי תשלום"),
        dashParagraph("תחילת העבודה מותנית בחתימה על חוזה עבודה מפורט על ידי כל הצדדים הרלוונטיים ובקבלת מקדמה בסך 40% (18,200 ₪ + מע\"מ)."),
        dashParagraph("תשלום שני בסך 30% (13,650 ₪ + מע\"מ) ישולם לאחר אספקת 5 הסרטונים הראשונים."),
        dashParagraph("יתרת התשלום בסך 30% (13,650 ₪ + מע\"מ) תשולם בסיום הפרויקט ואספקת כל הסרטונים."),
        dashParagraph("לאחר קבלת התשלום המלא תישלח חשבונית מס."),

        // ── לוחות זמנים ──

        sectionHeader("לוחות זמנים"),
        dashParagraph("קצב עבודה משוער: 1-3 סרטונים בשבוע, בהתאם למורכבות הסרטון."),
        dashParagraph("הלקוח יספק גישה למערכת, חומרים גרפיים, חומרי וידאו וכל תוכן נוסף אחר לפני תחילת העבודה ובמהלך העבודה השוטפת."),
        dashParagraph("עיכוב בהעברת החומרים יוביל לעיכוב בקצב העבודה."),
        dashParagraph("פגישת חפיפה ראשונית תתואם לפני תחילת העבודה ופגישות נוספות יקבעו בהמשך לפי הצורך."),

        // ── הערות כלליות ──

        sectionHeader("הערות כלליות"),
        dashParagraph("ההצעה בתוקף ל-30 יום מתאריך הנפקתה."),
        dashParagraph('המחיר אינו כולל מע"מ.'),
        dashParagraph("בהמשך להסכמה על הצעה זו, יישלח חוזה עבודה מפורט הכולל תנאים מלאים, מדיניות תיקונים, קניין רוחני ותנאים כלליים."),
      ],
    },
  ],
});

// ─── Generate ────────────────────────────────────────────────────────────────

const buffer = await Packer.toBuffer(doc);
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, buffer);

console.log(`Document generated successfully: ${OUTPUT_PATH}`);
