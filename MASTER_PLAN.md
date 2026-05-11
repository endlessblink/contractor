# MASTER PLAN — Freelance Doc Maker

## Completed
- [x] Skills pipeline (AI output + doc generation)
- [x] Multi-doc projects (formStates per docType)
- [x] Clients CRUD + fuzzy matching + sidebar dropdown
- [x] AI clause recommendations (auto-recommend on form fill)
- [x] Three-panel layout (sidebar + chat + form)
- [x] Dark theme redesign (Linear-inspired)
- [x] DOCX improvements (bullets, options table, payment table)
- [x] Profile auto-populate from scanned docs
- [x] Smart clause filtering (hide <40%, show-all toggle)
- [x] Bullet indentation fix (native DOCX numbering)
- [x] Form + chat save on refresh (sendBeacon)
- [x] Option label cleanup for single-option contracts
- [x] Client edit/delete in sidebar
- [x] Stale form fix on project switch
- [x] Universal button outline override for dark mode
- [x] 122 tests passing
- [x] Hub-page navigation — dashboard, clients/projects views, nav sidebar, doc-type switcher
- [x] Outlined button aesthetic — all buttons converted from solid fills to outlined style
- [x] Open source preparation — sample clauses, .gitignore, LICENSE, README

## Open Tasks

| ID | Task | Priority | Status |
|----|------|----------|--------|
| ~~**TASK-012**~~ | ✅ **E2E tests for chat→form flow** — Playwright tests verifying FORM_DATA/FORM_UPDATE modify form correctly | **P1** | ✅ **DONE** (2026-04-04) |
| **TASK-003** | **Preview panel** — togglePreview button exists, render-preview.mjs built, but not wired as modal | **P2** | TODO |
| ~~**TASK-009**~~ | ✅ **Light mode polish** — 10 fixes: resize handle, chat buttons, spinners, bulk bar, clear chat btn, form hover, ctx menu, sidebar-bg, JS separator | **P2** | ✅ **DONE** (2026-04-07) |
| **TASK-019** | **Button design tokens** — replace !important overrides with proper CSS custom properties for buttons | **P2** | TODO |
| **TASK-013** | **AI learns user preferences** — track patterns (no timelines, payment splits, clause removals). Store in user-preferences.json | **P2** | TODO |
| **TASK-014** | **Font selector in profile** — font picker in settings, apply to DOCX generation | **P2** | TODO |
| **TASK-020** | **Hub-page navigation** | **P0** | DONE |
| **TASK-021** | **Configurable form layout** — make form sections/fields dynamic instead of hardcoded HTML. Users can customize what appears in their documents. | **P1** | TODO |
| **TASK-022** | **Premium clause pack import** — UI for importing/purchasing curated clause packs. Supports the open-core business model. | **P2** | TODO |
| **TASK-005** | **Collapsible sidebar** — CSS ready, needs toggle button | **P3** | DONE (nav sidebar has collapse) |
| **TASK-006** | **Extract hardcoded fixes into doc-skills** — parse-service-options, strip-bullet-prefix, extend split-sentences | **P3** | TODO |
| **TASK-008** | **Onboarding flow** — doc scan primary, chat-driven fallback for new users | **P3** | TODO |
| **TASK-010** | **Mobile responsive** — three-panel layout needs mobile stacking | **P3** | TODO |
| ~~**TASK-023**~~ | ✅ **Landing page + demo GIF** — GitHub Pages landing page with RTL Hebrew, automated Playwright demo recording | **P1** | ✅ **DONE** (2026-04-06) |
| ~~**TASK-024**~~ | ✅ **Multi-select bulk delete for projects** — Hover-reveal checkboxes, floating action bar, shift+click range select, select-all, bulk delete with confirmation | **P1** | ✅ **DONE** (2026-04-06) |
| ~~**TASK-025**~~ | ✅ **Client → filtered projects navigation** — Clickable project count badge on client cards navigates to projects view pre-filtered by client | **P2** | ✅ **DONE** (2026-04-06) |
| ~~**TASK-033**~~ | ✅ **Claude Code sign-in** — Auto-detect Claude Code OAuth, one-click connect in Settings + onboarding wizard, no API key needed | **P1** | ✅ **DONE** (2026-04-10) |
| ~~**TASK-034**~~ | ✅ **AppImage for Linux** — Double-click install, auto-opens browser, integrated into build.mjs | **P1** | ✅ **DONE** (2026-04-09) |
| ~~**TASK-035**~~ | ✅ **Landing page: direct downloads + OS detection** — Auto-detect OS, direct binary download, macOS source install instructions | **P2** | ✅ **DONE** (2026-04-09) |
| ~~**TASK-036**~~ | ✅ **Post-onboarding hint arrows** — Animated hints guiding new users to documents and builder views | **P2** | ✅ **DONE** (2026-04-10) |
| **TASK-037** | **Apple Developer signing** — Enroll, sign + notarize macOS binaries, update build.mjs | **P1** | PLANNED |

#### TASK-037 — Apple Developer Signing (Full Pipeline)

**Steps:**
1. Enroll in Apple Developer Program ($99/year) — user confirmed willingness to pay
2. Create "Developer ID Application" certificate (via Xcode on Mac)
3. Generate App-Specific Password for notarization (appleid.apple.com)
4. Update `build.mjs` — add `codesign` + `xcrun notarytool` + `xcrun stapler` for mac targets
5. Optional: package as `.dmg` for drag-to-Applications install experience
6. Update landing page — replace source-install instructions with direct signed binary download
7. Test: download signed binary on clean Mac, verify no Gatekeeper warning
| **FEATURE-038** | **Recording to quote** — Record client conversation, transcribe (AssemblyAI/Whisper), AI extracts details to auto-fill quote form (~6h MVP) | **P2** | TODO |

## Document Templates (Post-Launch)

| ID | Task | Priority | Status |
|----|------|----------|--------|
| **TASK-026** | **Template system architecture** — Data model for templates (section config, density, visual skin), storage in settings, template selector UI in Settings modal "טופס" tab | **P1** | TODO |
| **TASK-027** | **Template: בהיר (Clear)** — Minimal one-page template. 6 sections, no full legal. Slate blue `#2563EB` accent, condensed spacing, borderless tables with alternating rows. Best for quick quotes. | **P2** | TODO |
| **TASK-028** | **Template: מקצועי (Professional)** — Full enterprise template. All 8 sections, navy `#1E3A5F` + light blue `#D6E4F0` headers, full border grid tables, From/To block. Matches existing reference doc style. | **P2** | TODO |
| **TASK-029** | **Template: יצירתי (Creative)** — Design-forward template. Off-white `#FAFAF8`, terracotta `#C0614B` accent, Heebo Light body, borderless pricing, narrative descriptions. For designers/photographers. | **P2** | TODO |
| **TASK-030** | **Template: משפטי (Legal)** — Formal contract template. No color, numbered clauses (1.1, 1.2), Heebo 10.5pt, tight spacing, all legal sections, formal signature block. For high-value contracts. | **P2** | TODO |
| **TASK-031** | **Template: סטנדרטי (Standard)** — Balanced default template. Teal `#0F6674` accent, side-border section headers, 7 of 8 sections, standard Israeli payment splits. The intelligent default. | **P2** | TODO |
| **TASK-032** | **Full layout editor** — Drag-to-reorder sections, per-field show/hide, custom field names, per-doctype defaults. Extends template system with user customization. | **P3** | TODO |

## CV Documents Lane

| ID | Task | Priority | Status |
|----|------|----------|--------|
| **TASK-038** | **Runtime document skills** — bundle editable Markdown skills for Israeli CVs and Hebrew document generation | **P0** | DONE |
| **TASK-039** | **CV document type** — add `cv` across frontend, backend mapping, project state, labels, filenames, and doc chips | **P0** | DONE |
| **TASK-040** | **CV data model + AI prompt** — support `cvData` FORM_DATA and load CV/document skills into prompt | **P0** | DONE |
| **TASK-041** | **RTL CV DOCX renderer** — dedicated Hebrew CV layout with proper mixed LTR contact/link handling | **P0** | DONE |
| **TASK-042** | **CV preview renderer** — add CV-specific HTML preview matching the DOCX structure | **P1** | DONE |
| **TASK-043** | **CV verification** — generate from Noam sample, extract text, verify sections and RTL markers | **P0** | DONE |
