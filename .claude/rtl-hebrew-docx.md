# RTL Hebrew DOCX Generation — Hard Rules

This document contains mandatory rules for generating Hebrew RTL DOCX files using the `docx` npm package (v9+). These rules were learned from real production failures and verified against working Hebrew documents.

## The Problem

The `docx` library defaults to LTR. Without explicit RTL configuration at **every level**, Hebrew text renders left-to-right, tables have reversed column order, and bullets/lists align incorrectly. LibreOffice and Word also handle RTL differently, so both must be tested.

---

## Mandatory RTL Rules

### 1. Every Paragraph MUST have `bidirectional: true`

```js
new Paragraph({
  bidirectional: true,  // REQUIRED — emits <w:bidi w:val="true"/>
  children: [...]
})
```

**Why:** Without this, Word treats the paragraph as LTR even if the text is Hebrew. The `bidirectional` property emits `<w:bidi/>` in the XML, which tells Word to use RTL paragraph direction.

**Critical detail:** The XML must be `<w:bidi w:val="true"/>` (with val attribute). Some versions of the docx library emit `<w:bidi/>` (without val) which Word sometimes ignores. If RTL doesn't work, check the generated XML.

### 2. Every TextRun MUST have `rightToLeft: true`

```js
new TextRun({
  text: "טקסט בעברית",
  rightToLeft: true,  // REQUIRED — emits <w:rtl/>
  language: { value: "he-IL", bidirectional: "he-IL" },
  font: { ascii: "Heebo", cs: "Heebo", eastAsia: "Heebo", hAnsi: "Heebo" },
})
```

**Exception:** English-only text (emails, URLs, phone numbers) should have `rightToLeft: false` to prevent character reordering.

### 3. Every Table MUST have `visuallyRightToLeft: true`

```js
new Table({
  visuallyRightToLeft: true,  // REQUIRED — emits <w:tblPr><w:bidiVisual/>
  rows: [...]
})
```

**Why:** Without this, table columns render in LTR order. The first column in code appears on the LEFT instead of the RIGHT. This is the most common RTL bug in Hebrew documents.

### 4. Do NOT use `alignment: AlignmentType.RIGHT` for RTL

Let `bidirectional: true` handle the alignment automatically. Adding explicit right alignment can conflict with bidi and cause inconsistent behavior between Word and LibreOffice.

**Exception:** Use `alignment: AlignmentType.CENTER` for centered titles. Use `alignment: AlignmentType.LEFT` only for footer contact details that should appear on the left side in RTL layout.

### 5. Document-level defaults

```js
new Document({
  styles: {
    default: {
      document: {
        run: {
          font: { ascii: "Heebo", cs: "Heebo", eastAsia: "Heebo", hAnsi: "Heebo" },
          size: "11pt",
          rightToLeft: true,
          language: { value: "he-IL", bidirectional: "he-IL" },
        },
        paragraph: {
          bidirectional: true,
        },
      },
    },
  },
})
```

**Important:** Document defaults are NOT enough. You still MUST set `bidirectional` and `rightToLeft` on every individual paragraph and run. Document defaults serve as fallback only.

---

## Helper Functions (Use These)

The project uses standardized helper functions. Always use them instead of creating raw Paragraph/TextRun objects:

```js
// RTL text run with consistent defaults
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

// RTL paragraph with consistent defaults
function rtlParagraph(children, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    children: Array.isArray(children) ? children : [children],
    spacing: { after: 120 },
    ...opts,
  });
}

// Section header with light blue background
function sectionHeader(text) {
  return new Paragraph({
    bidirectional: true,
    spacing: { before: 300, after: 200 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "D6E4F0" },
    children: [
      rtlRun(text, {
        bold: true, boldComplexScript: true,
        size: "16pt", sizeComplexScript: "16pt",
      }),
    ],
  });
}
```

---

## Mixed Hebrew/English Content

Hebrew documents often contain English words (brand names, technical terms, numbers). Handle them correctly:

| Content Type | `rightToLeft` | Example |
|---|---|---|
| Hebrew text | `true` | "הפקת סרטוני הדרכה" |
| English brand names inside Hebrew | `true` (keep RTL context) | "עבודה עם HeyGen" |
| Email addresses | `false` | "noamnau@gmail.com" |
| URLs | `false` | "noamn.com" |
| Phone numbers | `false` | "052-6784960" |
| Prices with ₪ | `true` | "3,700 ₪" |

**Rule of thumb:** If the text is part of a Hebrew sentence, keep `rightToLeft: true`. Only switch to `false` for standalone LTR strings (emails, URLs, phones).

---

## Bullets and Lists

The `docx` library's built-in numbering/bullet system has poor RTL support. Use Unicode bullet characters instead:

```js
function bulletParagraph(text) {
  return rtlParagraph([
    rtlRun("• "),
    rtlRun(text),
  ], { spacing: { after: 80 } });
}

// IMPORTANT: Use single TextRun for dash items — separate runs cause RTL alignment issues
function dashParagraph(text) {
  return rtlParagraph([
    rtlRun("- " + text),
  ], { spacing: { after: 80 }, alignment: AlignmentType.BOTH });
}
```

**Known RTL limitation:** Wrapped second lines may show a small horizontal gap from the right margin. This is an OnlyOffice renderer issue. Tested and failed approaches: `hanging` indent, table-based layout, `AlignmentType.RIGHT`, separate TextRuns. The single-run + justified approach above is the best available solution.

**Line spacing:** Use `line: N, lineRule: "exact"` (string, not enum) for tight wrapped lines. Values in twips: 180=clipping, 220=tight, 240=standard single.

---

## Font Configuration

Hebrew fonts must be specified in the `cs` (Complex Script) field:

```js
const FONT_OBJ = { ascii: "Heebo", cs: "Heebo", eastAsia: "Heebo", hAnsi: "Heebo" };
```

- `cs` = Complex Script — this is what Word uses for Hebrew/Arabic
- `ascii` and `hAnsi` = Latin characters
- Always set ALL four to ensure consistent rendering

**Recommended fonts:** Heebo (modern, clean), Frank Ruhl Libre (formal/legal), Arial (universal fallback)

**Bold for Hebrew:** Always set BOTH `bold: true` AND `boldComplexScript: true`. Word uses `boldComplexScript` for Hebrew characters.

Same for size: set BOTH `size` AND `sizeComplexScript`.

---

## Signature Areas

In RTL documents, the signature table should have:
- `visuallyRightToLeft: true`
- "הלקוח" (client) on the RIGHT (first cell in code)
- "הספק" (provider) on the LEFT (second cell in code)
- No borders

---

## Footer with Logo

For RTL footer with logo on the right and contact info on the left:
- Use a borderless table with `visuallyRightToLeft: true`
- First cell (appears RIGHT in RTL): logo image
- Second cell (appears LEFT in RTL): contact details with `alignment: AlignmentType.LEFT` and `rightToLeft: false` for email/phone

---

## Verification Checklist

After generating any Hebrew DOCX:

1. Open in Word (not just LibreOffice — they render RTL differently)
2. Check: text flows right-to-left
3. Check: table columns are in correct RTL order (first column = rightmost)
4. Check: bullets/dashes appear on the right side
5. Check: section headers have background color
6. Check: footer appears correctly with logo
7. Check: signature area has "הלקוח" on right, "הספק" on left

If available, also verify the raw XML:
```bash
unzip -p output.docx word/document.xml | grep -c "w:bidi"    # Should match paragraph count
unzip -p output.docx word/document.xml | grep -c "w:rtl"     # Should match text run count
unzip -p output.docx word/document.xml | grep -c "bidiVisual" # Should match table count
```
