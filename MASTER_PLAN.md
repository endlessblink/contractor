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
| **TASK-012** | **E2E tests for chat→form flow** — Playwright tests verifying FORM_DATA/FORM_UPDATE modify form correctly | **P1** | TODO |
| **TASK-003** | **Preview panel** — togglePreview button exists, render-preview.mjs built, but not wired as modal | **P2** | TODO |
| **TASK-009** | **Light mode polish** — clause text, form sections, chat bubbles need color fixes in light mode | **P2** | TODO |
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
