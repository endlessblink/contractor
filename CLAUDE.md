# Freelance Doc Maker

Hebrew-first RTL document generator for quotes (הצעת מחיר) and contracts (חוזה/הזמנת עבודה).

## Verification Rules (CRITICAL — READ FIRST)

These rules exist because of past failures. Follow them exactly.

### 1. Never declare "done" without output verification
- **Code compiling is NOT verification.** Syntax checks, `node --check`, "no errors" — none of this proves the feature works correctly.
- **Verification means comparing actual output against the source of truth.** For document generation: generate a real document and compare its content against the reference documents in `document refrences - quotes/`.
- If you can't verify output quality, say so explicitly. Never claim completion based on code-level checks alone.

### 2. Never hardcode content that should come from data
- All legal clauses, templates, payment patterns, and business terms come from `knowledge/clauses-db.json` — NEVER hardcode them in code or prompts.
- If content exists in reference documents but not in the DB, the DB is incomplete — don't work around it by hardcoding.
- The `learn-references` endpoint exists to extract content from documents. USE IT instead of manually copying content.

### 3. Never treat quantity as completeness
- "31 clauses in 9 categories" means nothing if the reference documents contain 50+ distinct clauses.
- Always compare extracted content against the actual source documents to check for gaps.
- When building a knowledge DB from documents, process ALL documents systematically — don't cherry-pick from a few.

### 4. Always verify against reference documents
- The 27 documents in `document refrences - quotes/` are the ground truth for what contracts should contain.
- Before claiming any clause/template work is complete, extract text from at least 2-3 reference contracts and verify coverage.
- Use `mammoth.extractRawText()` to read DOCX files and compare sections.

### 5. Run the system, don't just build it
- After implementing a feature, actually USE it end-to-end.
- For learn-references: run the endpoint, check what it produces, compare against source.
- For document generation: generate a document, read its content, compare against a real reference.
- For the frontend: load the page, interact with it, verify the UI shows the right data.

### 6. When the user says something isn't working, investigate before explaining
- Don't assume you know the issue. Look at what the user sees.
- Check the actual running server, actual API responses, actual rendered page.
- Browser cache, old server instances, stale data — verify the user is seeing current code.

---

## Project Overview

- **Owner:** (configure in Settings)
- **Contact:** (configure in Settings)
- **Title:** (configure in Settings)
- **Logo:** Place your logo in `assets/logo.png`

## Tech Stack

- Node.js with ES modules (.mjs)
- `docx` npm package (v9+) for DOCX generation
- `puppeteer` for PDF generation (HTML → PDF)
- Fonts: Heebo (primary), Arial (fallback)

## Key Files

- `src/generate-quote.mjs` — Quote/contract DOCX generator
- `assets/logo.png` — Logo for document footer
- `assets/fonts/` — Heebo font files
- `output/` — Generated documents
- `document refrences - quotes/` — Reference documents (DO NOT MODIFY)

## RTL Rules (CRITICAL)

**Read `.claude/rtl-hebrew-docx.md` before any DOCX work.** Key rules:

- Every Paragraph: `bidirectional: true`
- Every TextRun: `rightToLeft: true`
- Every Table: `visuallyRightToLeft: true`
- Bold Hebrew: set BOTH `bold` AND `boldComplexScript`
- Size Hebrew: set BOTH `size` AND `sizeComplexScript`
- Use helper functions: `rtlRun()`, `rtlParagraph()`, `sectionHeader()`

## Document Style Guide

Based on reference documents in `document refrences - quotes/`:

- **Font:** Heebo (body 11pt, headers 16pt, footer 9pt)
- **Section headers:** Bold, light blue background (#D6E4F0)
- **From/To table:** Light blue background, centered
- **Pricing tables:** Light gray borders, header row with blue background
- **Bullets:** Unicode "•" or "-" characters (not docx numbering — poor RTL support)
- **Footer:** Logo on right + contact info on left, thin gray separator line above
- **Signature area:** Borderless table, "הלקוח" right / "הספק" left
- **Page margins:** 0.8" top, 1" bottom, 0.9" left/right

## Payment Structure Patterns

From Noam's reference documents:
- Standard: 35% advance + 65% on completion
- Long projects (5+ deliverables): 40/30/30 three installments
- Hourly rate for extras: 185 ₪ + מע"מ
- Revision rounds: typically 2 included per deliverable
- Quote validity: 30 days

## Key Architecture

- `knowledge/clauses-db.json` — Structured clause database (source of truth for all legal content)
- `knowledge/learned-context.json` — Raw learned context from document analysis
- `src/server.mjs` — Backend with clause-aware system prompt (`buildClausesPromptSection()`)
- `src/generate-quote.mjs` — Document generator with intelligent clause selection (`getClauseTexts()`)
- `POST /api/learn-references` — Extracts clauses from reference docs into clauses-db.json
- `POST /api/save-clause` — Living DB: saves new clauses
- `GET /api/clauses-db` — Returns the full clause database
- Template selector populated from `clauses-db.json` service templates (not hardcoded)

## Commands

```bash
node src/server.mjs           # Start the server (port 6831)
node src/generate-quote.mjs   # Generate current quote (standalone)
```
