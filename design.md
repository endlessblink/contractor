# Design — Freelance Doc Maker (Contractor)

A Hebrew-first, RTL document generator for freelance quotes (הצעת מחיר) and contracts
(חוזה / הזמנת עבודה). Ships as a standalone desktop executable; end-users download a
binary from GitHub Releases — they never clone the repo.

---

## 🎯 Design Anchor — the Dashboard

**The dashboard (`.dashboard` in `public/index.html`) is the visual source of truth.**
Every other screen should move toward this language. It is a calm, premium "warm stone +
forest green" light surface — note it stays light even in dark mode (`html.dark .dashboard`
uses the same palette on purpose). This is intentionally distinct from the older teal
"Ink & Frost" dark theme; when they conflict, **the dashboard wins.**

### Palette

| Role | Value | Notes |
|------|-------|-------|
| Page background | `linear-gradient(180deg, #eef0ed → #e2e5e1 → #d8ddd8)` + white radial glow at top | warm stone, never flat |
| Ink (headings) | `#17202b` | weight 800 |
| Body text | `#5c6675` / card desc `#627083` | |
| Muted / eyebrow / label | `#6c7887` / `#5e6873` | |
| **Primary CTA** | bg `#12352f`, text `#f8f4ea` (cream), hover `#0d493e` | deep forest green — one per view |
| Accent (links, icons) | `#27645a`; icon glyph `#123f37` | forest green, **not** bright teal |
| Icon chip | `linear-gradient(145deg, #d7ece7, #f7fbf9)` + white radial highlight | soft mint tile |
| Stat icon | `#27645a` on `rgba(217,239,234,0.74)` | |

### Surfaces (translucent, layered, large radii)

| Element | Radius | Background | Border | Shadow |
|---------|--------|-----------|--------|--------|
| Hero / start card | 30px | near-white gradient + faint line texture | `rgba(51,61,70,0.14)` | `0 28px 80px rgba(38,48,58,0.11)` + inset highlight |
| Section card | 26px | `rgba(248,249,247,0.66)` | `rgba(51,61,70,0.12)` | `0 18px 50px rgba(38,48,58,0.08)` |
| Doc-type card | 22px | `rgba(255,255,253,0.74)` | `rgba(51,61,70,0.13)` | `0 12px 34px rgba(38,48,58,0.07)` |
| Stat card | 18px | `rgba(248,249,247,0.72)` | `rgba(51,61,70,0.10)` | — |
| Quick-action btn | 14px | `rgba(255,255,255,0.58)` | `rgba(51,61,70,0.13)` | — |

Radius scale: **14 · 16 · 18 · 22 · 26 · 30**. Borders are hairline dark at very low opacity;
fills are translucent off-white so the warm gradient shows through.

### Typography (Heebo, RTL)

| Token | Size | Weight | Detail |
|-------|------|--------|--------|
| Eyebrow | 0.82rem | 700 | letter-spacing 0.04em, `#5e6873` |
| Headline | clamp(2.1rem, 4.8vw, 4.2rem) | 800 | line-height 1.02, letter-spacing −0.045em, `text-wrap: balance` |
| Sub | 1–1.18rem | 400 | line-height 1.75, `#5c6675` |
| Card label | 1.05rem | 800 | |
| Card desc | 0.86rem | 400 | line-height 1.45 |
| Stat value | 1.12rem | 800 | `font-variant-numeric: tabular-nums` |
| Stat / section label | 0.78rem | — | |

### Motion

Hover = lift + deepen shadow: `translateY(-1px → -3px)`, `180ms cubic-bezier(0.16, 1, 0.3, 1)`.
Cards brighten their fill on hover (e.g. `0.74 → 0.96` opacity). Active resets the lift.

### Principles to carry to every screen

1. Warm stone gradient base — never a flat gray/white slab.
2. Soft, translucent, large-radius cards floating in generous whitespace.
3. Exactly **one** deep-forest primary CTA per view; everything else is outline/ghost.
4. Forest-green accents for links and icon tiles — **avoid bright cyan/teal here.**
5. Tabular numerals for all stats and prices.
6. Hairline low-opacity dark borders + layered soft shadows for depth, not heavy lines.

---

## Goals

- Generate professional, legally-grounded Hebrew RTL DOCX/PDF documents from structured data.
- Keep all legal content data-driven (never hardcoded), sourced from real reference documents.
- Let a freelancer go from a short description (or chat) to a finished quote/contract fast.
- Run fully locally as a packaged app, with optional AI assistance via the user's own Claude Code.

## Non-Goals

- Multi-tenant SaaS / cloud hosting (the app is a local single-user tool).
- General-purpose document editing (scope is quotes and contracts only).
- Storing or transmitting user data to external services beyond the user's chosen AI provider.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  public/index.html  (RTL single-page UI)                 │
│   form ⇄ skills-pipeline.js (client-side post-processing) │
└───────────────┬─────────────────────────────────────────┘
                │  HTTP (localhost:6831)
┌───────────────▼─────────────────────────────────────────┐
│  src/server.mjs   (Node ESM backend)                     │
│   • AI prompt assembly (buildClausesPromptSection)       │
│   • /api/learn-references, /api/save-clause, /api/clauses │
│   • data-layer.mjs (projects, clients, profiles)         │
└───────┬───────────────────────────────┬─────────────────┘
        │                               │
┌───────▼──────────┐          ┌─────────▼─────────────┐
│ knowledge/        │          │ src/generate-quote.mjs │
│  clauses-db.json  │  feeds   │  DOCX generator        │
│  (source of truth)│ ───────▶ │  (RTL helpers)         │
│  learned-context  │          │  src/render-preview    │
└───────────────────┘          │  → output/*.docx/pdf   │
                               └────────────────────────┘
```

### Key components

- **`src/server.mjs`** — backend on port 6831 (dev). Builds the clause-aware AI system
  prompt, serves the UI, exposes the clause/learning APIs and data endpoints.
- **`src/generate-quote.mjs`** — DOCX generator with intelligent clause selection
  (`getClauseTexts()`) and the RTL helper functions.
- **`src/render-preview.mjs`** — HTML preview → PDF via Puppeteer.
- **`src/data-layer.mjs`** — persistence for projects, clients, and user profiles.
- **`src/ai-provider.mjs`** — AI integration (uses the user's own Claude Code / provider).
- **`src/mcp-server.mjs`** — MCP surface for agent-driven draft creation.
- **`knowledge/clauses-db.json`** — structured clause database; the single source of truth
  for all legal content. **Never hardcode clauses in code or prompts.**

## Skills Pipeline (AI output post-processing)

All AI output (`FORM_DATA` / `FORM_UPDATE`) passes through a modular, isomorphic pipeline
(`src/shared/skills/`, bundled to `public/js/skills-pipeline.js`) before reaching the form.
This replaces verbose prompt instructions with reliable code.

| Skill | Stage | FailMode | Purpose |
|-------|-------|----------|---------|
| `parse-json` | parse | critical | Parse JSON, repair trailing commas / truncated brackets |
| `validate-schema` | validate | critical | Ensure required fields, coerce price types |
| `detect-options` | transform | graceful | Set `option` when desc contains "אופציה X" |
| `format-text-fields` | transform | graceful | Split notes/details/timeline by `. ` into lines |
| `trim-description` | transform | graceful | Keep projectDescription < 80 chars; overflow → serviceDetails |
| `log-transforms` | log | graceful | Diff before/after for dev logging |

- **critical** failMode stops the pipeline and surfaces the error.
- **graceful** failMode logs and continues with unchanged data.
- The system prompt keeps only thin format hints as defense-in-depth.

## RTL / Hebrew Rules (critical)

DOCX RTL is fragile — follow these without exception (see `.claude/rtl-hebrew-docx.md`):

- Every `Paragraph`: `bidirectional: true`
- Every `TextRun`: `rightToLeft: true`
- Every `Table`: `visuallyRightToLeft: true`
- Bold Hebrew: set **both** `bold` and `boldComplexScript`
- Sized Hebrew: set **both** `size` and `sizeComplexScript`
- Use the helpers: `rtlRun()`, `rtlParagraph()`, `sectionHeader()`

## Document Style

- **Font:** Heebo (body 11pt, headers 16pt, footer 9pt), Arial fallback.
- **Section headers:** bold, light-blue background (#D6E4F0).
- **From/To & pricing tables:** light-blue header rows, gray borders.
- **Bullets:** Unicode "•"/"-" (not docx numbering — poor RTL support).
- **Footer:** logo right + contact left, thin gray separator above.
- **Signatures:** borderless table, "הלקוח" right / "הספק" left.
- **Margins:** 0.8" top, 1" bottom, 0.9" sides.

### Payment patterns (from reference docs)

- Standard: 35% advance + 65% on completion.
- Long projects (5+ deliverables): 40/30/30.
- Hourly extras: 185 ₪ + מע"מ · revisions: 2 rounds/deliverable · quote validity: 30 days.

## Data Sources & Verification

- **Ground truth:** the 27 reference documents in `document refrences - quotes/` (do not modify).
- Build the clause DB from documents via `POST /api/learn-references` — don't copy content by hand.
- Verification means **comparing generated output against reference documents**, not just that
  code compiles. Read DOCX with `mammoth.extractRawText()` and compare sections before claiming
  any clause/template work is complete.

## Packaging & Delivery

- Built via `npm run build` (`build.mjs` + `@yao-pkg/pkg`) into standalone executables.
- AppImage for Linux (`npm run build:linux`); per-platform binaries uploaded to GitHub Releases.
- Test the **executable** in an isolated dir (the real user experience), not just `npm start`.
- After every change: commit → push immediately (GitHub Pages updates the landing page) →
  rebuild binaries if app code changed → `gh release upload`.

## Landing Page

- `docs/index.html` — single inline HTML/CSS/JS file served via GitHub Pages (master /docs).
- URL: https://endlessblink.github.io/contractor/
- Dark "Ink & Frost" theme (teal #00d2b4 on #0c0e13), Heebo, full RTL.
- Must pass: RTL layout, 375px mobile, no-JS fallback, no personal data in screenshots/GIF.

## Commands

```bash
node src/server.mjs           # dev server (port 6831)
node src/generate-quote.mjs   # standalone quote generation
npm run build:skills          # rebuild skills pipeline bundle
npm run build                 # build packaged executables
```
