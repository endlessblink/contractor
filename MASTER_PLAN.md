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
- [x] 122 tests passing

## In Progress

| ID | Task | Priority | Status |
|----|------|----------|--------|
| ~~**TASK-001**~~ | ~~**"רענן המלצות" button doesn't work**~~ — was cached empty response, fixed by server restart | **P1** | ✅ **DONE** |
| ~~**TASK-002**~~ | ~~**Chat history lost on refresh**~~ — added sendBeacon for chat + form on beforeunload | **P1** | ✅ **DONE** |
| **TASK-011** | **Clauses show all non-relevant items** — form shows 100+ clauses, most irrelevant. Should hide low-relevance clauses by default. | **P1** | TODO |
| **TASK-003** | **Preview panel not functional** — togglePreview button exists but no preview modal/renderer wired | **P2** | TODO |
| **TASK-004** | **Sidebar client tree not showing** — renderSidebarTree() from stash not in current code | **P2** | TODO |
| **TASK-005** | **Collapsible sidebar** — CSS added but no toggle button in the UI | **P3** | TODO |
| **TASK-006** | **Extract hardcoded fixes into doc-skills** — P1-P4 from audit (parse-service-options, strip-bullet-prefix, extend split-sentences, harmonize filter-meta-text) | **P3** | TODO |
| **TASK-007** | **Font selection** — add font picker for generated documents | **P3** | TODO |
| **TASK-008** | **Onboarding flow** — doc scan primary, chat-driven fallback for new users | **P3** | TODO |
| **TASK-009** | **Light mode polish** — several elements still have wrong colors in light mode | **P2** | TODO |
| **TASK-010** | **Mobile responsive** — three-panel layout needs mobile stacking | **P3** | TODO |
