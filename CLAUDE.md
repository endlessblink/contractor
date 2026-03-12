# Freelance Doc Maker

Hebrew-first RTL document generator for quotes (הצעת מחיר) and contracts (חוזה/הזמנת עבודה).

## Project Overview

- **Owner:** נועם נאומובסקי (Noam Naumovsky) | Noam Naumovsky Productions
- **Contact:** noamnau@gmail.com | noamn.com | 052-6784960
- **Title:** במאי, עורך, אנימטור
- **Logo:** `logo-2026_768p.png` (blue-to-teal tech gradient)

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

## Commands

```bash
node src/generate-quote.mjs  # Generate current quote
```
