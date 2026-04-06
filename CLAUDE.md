# Freelance Doc Maker

Hebrew-first RTL document generator for quotes (הצעת מחיר) and contracts (חוזה/הזמנת עבודה).

## Verification Rules (CRITICAL — READ FIRST)

These rules exist because of past failures. Follow them exactly.

### 1. This is a packaged app — test like an end-user
- **This project ships as a standalone executable** built via `npm run build` + `@yao-pkg/pkg`. End-users download a binary from GitHub Releases — they never clone the repo or run `npm install`.
- **When testing installation/startup**, always test the executable first: build it, copy it to an isolated directory, run it. That's the real user experience.
- `npm install` + `npm start` is the **developer** workflow, not the user workflow. Test both, but prioritize the executable path.
- Never suggest "clone and npm install" as the end-user testing path.

### 2. Never declare "done" without output verification
- **Code compiling is NOT verification.** Syntax checks, `node --check`, "no errors" — none of this proves the feature works correctly.
- **Verification means comparing actual output against the source of truth.** For document generation: generate a real document and compare its content against the reference documents in `document refrences - quotes/`.
- If you can't verify output quality, say so explicitly. Never claim completion based on code-level checks alone.

### 3. Never hardcode content that should come from data
- All legal clauses, templates, payment patterns, and business terms come from `knowledge/clauses-db.json` — NEVER hardcode them in code or prompts.
- If content exists in reference documents but not in the DB, the DB is incomplete — don't work around it by hardcoding.
- The `learn-references` endpoint exists to extract content from documents. USE IT instead of manually copying content.

### 4. Never treat quantity as completeness
- "31 clauses in 9 categories" means nothing if the reference documents contain 50+ distinct clauses.
- Always compare extracted content against the actual source documents to check for gaps.
- When building a knowledge DB from documents, process ALL documents systematically — don't cherry-pick from a few.

### 5. Always verify against reference documents
- The 27 documents in `document refrences - quotes/` are the ground truth for what contracts should contain.
- Before claiming any clause/template work is complete, extract text from at least 2-3 reference contracts and verify coverage.
- Use `mammoth.extractRawText()` to read DOCX files and compare sections.

### 6. Run the system, don't just build it
- After implementing a feature, actually USE it end-to-end.
- For learn-references: run the endpoint, check what it produces, compare against source.
- For document generation: generate a document, read its content, compare against a real reference.
- For the frontend: load the page, interact with it, verify the UI shows the right data.

### 7. When the user says something isn't working, investigate before explaining
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

## Skills Pipeline (AI Output Post-Processing)

All AI output (FORM_DATA / FORM_UPDATE) passes through a modular skills pipeline before reaching the form. This enforces formatting, validates data, and repairs common AI mistakes — replacing verbose system prompt instructions with reliable code.

**Source:** `src/shared/skills/` (isomorphic — runs in browser and Node.js)
**Bundle:** `public/js/skills-pipeline.js` (auto-generated IIFE, loaded in index.html)
**Build:** `npm run build:skills` (uses esbuild, also runs as part of `npm run build`)

### Skills (execution order)

| Skill | Stage | FailMode | What it does |
|-------|-------|----------|--------------|
| `parse-json` | parse | critical | Parses JSON, repairs trailing commas / truncated brackets |
| `validate-schema` | validate | critical | Ensures required fields exist, coerces price types |
| `detect-options` | transform | graceful | Auto-sets `option` field when desc contains "אופציה X" |
| `format-text-fields` | transform | graceful | Splits notes/serviceDetails/timeline by `. ` into `\n` lines |
| `trim-description` | transform | graceful | Keeps projectDescription under 80 chars, moves overflow to serviceDetails |
| `log-transforms` | log | graceful | Diffs before/after, logs to console in dev |

### Adding a new skill

1. Create `src/shared/skills/my-skill.mjs` exporting `{ name, stage, failMode, run(ctx) }`
2. Import and register in `src/shared/skills/index.mjs`
3. Run `npm run build:skills` to rebuild the browser bundle
4. Skill runs automatically — no changes to index.html needed

### FailMode behavior

- **critical:** Pipeline stops, error surfaced to user. Use for parsing/validation.
- **graceful:** Error logged, pipeline continues with unchanged data. Use for formatting/enrichment.

### Architecture notes

- System prompt contains thin format hints as defense-in-depth (not the primary enforcement)
- Skills are pure functions on a SkillContext object — no DOM or Node.js dependencies
- Phase 2 (future): run pipeline server-side in the AI response stream before sending to client

## Delivery Workflow (MANDATORY)

**The user tests from a packaged executable on a Windows VM.** Source-only changes are invisible to them. After EVERY code change, you MUST complete the full cycle:

1. `npm run build` — rebuild the executable
2. `git add` + `git commit` — commit all changes
3. `git push` — push to GitHub

If bumping the version, also create a GitHub release with the built executables so the in-app update button can find them.

**Never stop at just editing files.** If you changed code, build and push it.

## Commands

```bash
node src/server.mjs           # Start the server (port 6831) — dev only
node src/generate-quote.mjs   # Generate current quote (standalone)
npm run build:skills          # Rebuild skills pipeline bundle
npm run build                 # Build packaged executables (dist/executables/)
```

## Landing Page & Docs

- **Landing page:** `docs/index.html` — single HTML file served via GitHub Pages
- **URL:** https://endlessblink.github.io/contractor/
- **Design:** Dark "Ink & Frost" theme (teal #00d2b4 on #0c0e13), Heebo font, full RTL
- **Demo GIF:** `docs/demo.gif` — auto-recorded via `npm run demo` (Playwright script at `e2e/record-demo.mjs`)
- **Screenshots:** Taken from clean app instance with `CONTRACTOR_DATA_DIR` isolation — no personal data
- **GitHub Pages config:** master branch, /docs folder

### When modifying the landing page:
- All CSS/JS is inline in `index.html` — no build step
- Test RTL layout, mobile responsiveness (375px), and no-JS fallback
- Verify no personal data in screenshots or demo GIF
- The `.hero > *` selector must NOT override `.hero-glow-secondary { position: absolute }` — this caused a 500px dead space bug
- Push and wait ~1 min for GitHub Pages CDN to update

### Regenerating demo:
```bash
npm run demo   # records docs/demo.webm via Playwright
# Convert to GIF (requires ffmpeg):
ffmpeg -i docs/demo.webm -vf "fps=8,scale=720:-1:flags=lanczos,palettegen" /tmp/p.png && ffmpeg -i docs/demo.webm -i /tmp/p.png -lavfi "fps=8,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse" -loop 0 docs/demo.gif
```
