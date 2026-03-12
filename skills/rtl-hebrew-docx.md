# Skill: RTL Hebrew DOCX Generation

**Trigger:** Any task involving Hebrew document generation, DOCX creation with Hebrew text, or RTL document formatting.

**Purpose:** Ensure 100% correct Right-to-Left Hebrew rendering in DOCX files generated with the `docx` npm package.

---

## Context

The `docx` npm library (v9+) defaults to LTR. Hebrew documents REQUIRE explicit RTL configuration at every level — document settings, paragraphs, text runs, and tables. Missing RTL at ANY level causes broken rendering in Word and LibreOffice.

These rules were learned from real production failures and verified against working Hebrew DOCX documents.

---

## Mandatory Rules

### Rule 1: Every Paragraph → `bidirectional: true`

```js
new Paragraph({
  bidirectional: true, // emits <w:bidi w:val="true"/>
  children: [...]
})
```

Without this, Word treats the paragraph as LTR even with Hebrew text.

### Rule 2: Every TextRun → `rightToLeft: true`

```js
new TextRun({
  text: "טקסט בעברית",
  rightToLeft: true,              // emits <w:rtl/>
  language: { value: "he-IL", bidirectional: "he-IL" },
  font: { ascii: "Heebo", cs: "Heebo", eastAsia: "Heebo", hAnsi: "Heebo" },
})
```

**Exception:** Standalone English strings (emails, URLs, phone numbers) → `rightToLeft: false`.

### Rule 3: Every Table → `visuallyRightToLeft: true`

```js
new Table({
  visuallyRightToLeft: true, // emits <w:tblPr><w:bidiVisual/>
  rows: [...]
})
```

Without this, table columns appear in LTR order (first column on LEFT instead of RIGHT).

### Rule 4: Do NOT use `alignment: AlignmentType.RIGHT`

Let `bidirectional: true` handle alignment. Explicit RIGHT alignment conflicts with bidi. Only use `AlignmentType.CENTER` for centered content and `AlignmentType.LEFT` for content that should appear left in RTL (like footer contact info).

### Rule 5: Bold and Size — always set BOTH variants

```js
rtlRun("כותרת", {
  bold: true,
  boldComplexScript: true,  // Word uses this for Hebrew
  size: "16pt",
  sizeComplexScript: "16pt", // Word uses this for Hebrew
})
```

Word renders Hebrew with Complex Script properties. If you only set `bold` without `boldComplexScript`, Hebrew text won't be bold.

### Rule 6: Font — always set `cs` field

```js
const FONT_OBJ = { ascii: "Heebo", cs: "Heebo", eastAsia: "Heebo", hAnsi: "Heebo" };
```

`cs` (Complex Script) is what Word uses for Hebrew/Arabic characters. Without it, Hebrew falls back to a default font.

### Rule 7: Document-level defaults (supplement, not replacement)

```js
new Document({
  styles: {
    default: {
      document: {
        run: {
          font: FONT_OBJ,
          rightToLeft: true,
          language: { value: "he-IL", bidirectional: "he-IL" },
        },
        paragraph: { bidirectional: true },
      },
    },
  },
})
```

**IMPORTANT:** Document defaults are NOT enough. You still MUST set `bidirectional` and `rightToLeft` on every individual paragraph and run.

---

## Helper Function Pattern

Always use wrapper functions for consistency:

```js
function rtlRun(text, opts = {}) {
  return new TextRun({
    text,
    rightToLeft: true,
    font: FONT_OBJ,
    size: "11pt",
    language: { value: "he-IL", bidirectional: "he-IL" },
    ...opts,
  });
}

function rtlParagraph(children, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    children: Array.isArray(children) ? children : [children],
    spacing: { after: 120 },
    ...opts,
  });
}
```

---

## Mixed Hebrew/English Content

| Content Type | `rightToLeft` | Example |
|---|---|---|
| Hebrew text | `true` | "הפקת סרטוני הדרכה" |
| English inside Hebrew sentence | `true` | "עבודה עם HeyGen" |
| Standalone email | `false` | "noamnau@gmail.com" |
| Standalone URL | `false` | "noamn.com" |
| Phone number | `false` | "052-6784960" |
| Price with ₪ | `true` | "3,700 ₪" |

---

## Bullets and Lists

The `docx` library's built-in numbering/bullet system has poor RTL support. Use Unicode bullet characters for simple single-line items:

```js
function bulletParagraph(text) {
  return rtlParagraph([rtlRun("• "), rtlRun(text)], { spacing: { after: 80 } });
}
```

### Dash Items with Wrapping Text

**Known issue:** In RTL documents, wrapped second lines may show a small horizontal gap from the right margin. This is an OnlyOffice/renderer limitation — not fixable via `indent`, `alignment`, or table-based approaches. Tested approaches that do NOT work:
- `indent: { hanging: N }` — causes worse misalignment in RTL
- Table-based (dash cell + text cell) — breaks RTL direction entirely in OnlyOffice
- `alignment: AlignmentType.BOTH` (justified) — no effect on the gap
- `alignment: AlignmentType.RIGHT` — disables RTL behavior

**Best approach:** Use a single TextRun with dash + text combined. This gives correct RTL with minimal gap:

```js
function dashParagraph(text) {
  return rtlParagraph([
    rtlRun("- " + text),
  ], { spacing: { after: 80 }, alignment: AlignmentType.BOTH });
}
```

**Line spacing notes:** `line` property with `lineRule: "exact"` DOES work in OnlyOffice. Values in twips when lineRule is "exact": 180=clipping, 200=slightly tight, 220=tight single, 240=standard single. Use `"exact"` string (not `"exactly"` — known docx library bug).

---

## Verification

After generating any Hebrew DOCX, verify with:

```bash
unzip -p output.docx word/document.xml | grep -c "w:bidi"      # ≥ paragraph count
unzip -p output.docx word/document.xml | grep -c "w:rtl"       # ≥ text run count
unzip -p output.docx word/document.xml | grep -c "bidiVisual"  # = table count
```

Then open in **both** Word AND LibreOffice — they render RTL differently.
