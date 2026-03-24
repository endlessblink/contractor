# MASTER PLAN — Freelance Doc Maker

## Completed
- [x] Skills pipeline (AI output + doc generation)
- [x] Multi-doc projects (formStates per docType)
- [x] Clients CRUD + fuzzy matching
- [x] AI clause recommendations (auto-recommend on form fill)
- [x] Three-panel layout (sidebar + chat + form)
- [x] Dark theme redesign (Linear-inspired)
- [x] DOCX improvements (bullets, options table, payment table)
- [x] Profile auto-populate from scanned docs
- [x] Smart clause filtering (hide <40%, show-all toggle)
- [x] Bullet indentation fix (native DOCX numbering)
- [x] Form + chat save on refresh (sendBeacon)
- [x] Option label cleanup for single-option contracts
- [x] 122 tests passing

## Open Tasks

| ID | Task | Priority | Status |
|----|------|----------|--------|
| **TASK-012** | **E2E tests for chat→form flow** — Playwright tests verifying FORM_DATA/FORM_UPDATE modify form correctly | **P1** | TODO |
| **TASK-004** | **Sidebar client tree not showing** — renderSidebarTree() from stash not in current code. Clients exist in API but sidebar shows old project list | **P1** | TODO |
| **TASK-003** | **Preview panel not functional** — togglePreview button exists but no preview modal/renderer wired. render-preview.mjs built but not connected | **P2** | TODO |
| **TASK-009** | **Light mode polish** — clause text invisible (white on white), form sections wrong colors, chat bubbles unreadable | **P2** | TODO |
| **TASK-016** | **"החל הכל" button still bright in some contexts** — global dark override misses dynamically-created buttons. Need to ensure ALL generated buttons follow outline style | **P2** | TODO |
| **TASK-013** | **AI learns user preferences** — track user patterns (no timelines, preferred payment split, clause removals). Store in user-preferences.json, inject into system prompt | **P2** | TODO |
| **TASK-014** | **Font selector in profile** — add font picker to settings. Apply to generated DOCX. Options: Heebo, Noto Sans Hebrew, Assistant, Rubik | **P2** | TODO |
| **TASK-005** | **Collapsible sidebar** — CSS added but no toggle button in the UI | **P3** | TODO |
| **TASK-006** | **Extract hardcoded fixes into doc-skills** — parse-service-options, strip-bullet-prefix, extend split-sentences | **P3** | TODO |
| **TASK-008** | **Onboarding flow** — doc scan primary, chat-driven fallback for new users | **P3** | TODO |
| **TASK-010** | **Mobile responsive** — three-panel layout needs mobile stacking | **P3** | TODO |
