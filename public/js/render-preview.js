var DocPreview = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/render-preview.mjs
  var render_preview_exports = {};
  __export(render_preview_exports, {
    renderPreviewHTML: () => renderPreviewHTML
  });

  // src/shared/doc-skills/context.mjs
  function createDocContext(data) {
    return {
      data,
      logs: [],
      errors: [],
      failed: false,
      failReason: null
    };
  }

  // src/shared/doc-skills/registry.mjs
  var skills = [];
  function registerSkill(skill) {
    skills.push(skill);
  }
  function getSkills(stage) {
    return stage ? skills.filter((s) => s.stage === stage) : [...skills];
  }
  function clearSkills() {
    skills.length = 0;
  }
  var DEFAULT_STAGES = ["transform", "log"];
  function runPipeline(ctx, stages) {
    const stageOrder = stages || DEFAULT_STAGES;
    for (const stage of stageOrder) {
      for (const skill of getSkills(stage)) {
        try {
          ctx = skill.run(ctx);
        } catch (err) {
          if (skill.failMode === "critical") {
            ctx.failed = true;
            ctx.failReason = `[${skill.name}] ${err.message}`;
            ctx.errors.push(err);
            return ctx;
          }
          ctx.errors.push(err);
          ctx.logs.push(`[${skill.name}] WARN: ${err.message} -- skipped`);
        }
      }
    }
    return ctx;
  }

  // src/shared/doc-skills/trim-description.mjs
  var MAX_LENGTH = 80;
  function splitAtFirstSentence(text) {
    const dotIdx = text.indexOf(". ");
    const nlIdx = text.indexOf("\n");
    let splitAt = -1;
    if (dotIdx > 0 && dotIdx < MAX_LENGTH) {
      splitAt = dotIdx + 1;
    }
    if (nlIdx > 0 && nlIdx < MAX_LENGTH && (splitAt < 0 || nlIdx < splitAt)) {
      splitAt = nlIdx;
    }
    if (splitAt > 0) {
      return {
        title: text.slice(0, splitAt).trim(),
        rest: text.slice(splitAt).replace(/^[\s.]+/, "").trim()
      };
    }
    const lastComma = text.lastIndexOf(",", MAX_LENGTH);
    if (lastComma > 20) {
      return {
        title: text.slice(0, lastComma).trim(),
        rest: text.slice(lastComma + 1).trim()
      };
    }
    return {
      title: text.slice(0, MAX_LENGTH).trim(),
      rest: text.slice(MAX_LENGTH).trim()
    };
  }
  var trimDescriptionSkill = {
    name: "trim-description",
    stage: "transform",
    failMode: "graceful",
    run(ctx) {
      const data = ctx.data;
      if (!data) return ctx;
      if (typeof data.projectDescription === "string" && data.projectDescription.length > MAX_LENGTH) {
        const original = data.projectDescription;
        const { title, rest } = splitAtFirstSentence(original);
        data.projectDescription = title;
        if (rest) {
          data.serviceDetails = data.serviceDetails ? rest + "\n" + data.serviceDetails : rest;
        }
        ctx.logs.push(`[trim-description] Trimmed projectDescription from ${original.length} to ${title.length} chars`);
      }
      return ctx;
    }
  };

  // src/shared/doc-skills/strip-option-prefix.mjs
  var OPTION_PREFIX_RE = /^אופציה\s*\d+\s*[–—\-:]\s*/;
  var stripOptionPrefixSkill = {
    name: "strip-option-prefix",
    stage: "transform",
    failMode: "graceful",
    run(ctx) {
      const data = ctx.data;
      if (!data) return ctx;
      let count = 0;
      if (Array.isArray(data.pricingItems)) {
        for (const item of data.pricingItems) {
          if (!item || typeof item.description !== "string") continue;
          const original = item.description;
          const stripped = original.replace(OPTION_PREFIX_RE, "").trim();
          if (stripped !== original) {
            item.description = stripped;
            count++;
          }
        }
      }
      if (typeof data.serviceDetails === "string" && data.serviceDetails) {
        const optionCount = new Set(
          (data.pricingItems || []).map((i) => i.option).filter(Boolean)
        ).size;
        if (optionCount <= 1) {
          const lines = data.serviceDetails.split("\n");
          const cleaned = lines.map((line) => line.replace(OPTION_PREFIX_RE, "").trim()).filter((line) => !/אופציו?ת.*לבחירה|יש לבחור|המחיר.*לאופציה הנבחרת/i.test(line));
          const result = cleaned.join("\n");
          if (result !== data.serviceDetails) {
            data.serviceDetails = result;
            count++;
            ctx.logs.push(`[strip-option-prefix] Cleaned option labels from serviceDetails (single option)`);
          }
        }
      }
      if (count > 0 && !ctx.logs.some((l) => l.includes("serviceDetails"))) {
        ctx.logs.push(`[strip-option-prefix] Stripped option prefix from ${count} item(s)`);
      }
      return ctx;
    }
  };

  // src/shared/doc-skills/split-sentences.mjs
  function splitLine(line) {
    if (!line.includes(". ")) return [line];
    return line.split(". ").map((s) => s.trim()).filter(Boolean).map((s) => s.endsWith(".") ? s : s + ".");
  }
  var splitSentencesSkill = {
    name: "split-sentences",
    stage: "transform",
    failMode: "graceful",
    run(ctx) {
      const data = ctx.data;
      if (!data || typeof data.serviceDetails !== "string") return ctx;
      const original = data.serviceDetails;
      const lines = original.split("\n");
      const result = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = splitLine(trimmed);
        result.push(...parts);
      }
      const newValue = result.join("\n");
      if (newValue !== original) {
        data.serviceDetails = newValue;
        ctx.logs.push(`[split-sentences] Split serviceDetails from ${lines.length} to ${result.length} lines`);
      }
      return ctx;
    }
  };

  // src/shared/doc-skills/filter-meta-text.mjs
  var META_PATTERNS = [
    /אופציו?ת.*לבחירה/,
    /יש לבחור/,
    /בחר אחת/,
    /להלן.*אופציו?ת/,
    /שתי חלופות/,
    /יש.*לבחור.*אחת.*בלבד/
  ];
  function isMetaLine(line) {
    return META_PATTERNS.some((re) => re.test(line));
  }
  var filterMetaTextSkill = {
    name: "filter-meta-text",
    stage: "transform",
    failMode: "graceful",
    run(ctx) {
      const data = ctx.data;
      if (!data || typeof data.serviceDetails !== "string") return ctx;
      const lines = data.serviceDetails.split("\n");
      const filtered = [];
      let removedCount = 0;
      for (const line of lines) {
        if (isMetaLine(line.trim())) {
          removedCount++;
        } else {
          filtered.push(line);
        }
      }
      if (removedCount > 0) {
        data.serviceDetails = filtered.join("\n");
        ctx.logs.push(`[filter-meta-text] Removed ${removedCount} meta-text line(s)`);
      }
      return ctx;
    }
  };

  // src/shared/doc-skills/log-transforms.mjs
  function isLoggingEnabled() {
    if (typeof window !== "undefined") {
      return window.__DOC_SKILLS_LOG !== false;
    }
    if (typeof process !== "undefined" && process.env) {
      return process.env.DOC_SKILLS_LOG !== "0";
    }
    return true;
  }
  var logTransformsSkill = {
    name: "log-transforms",
    stage: "log",
    failMode: "graceful",
    run(ctx) {
      if (!isLoggingEnabled()) return ctx;
      if (ctx.logs.length > 0) {
        const logger = typeof console !== "undefined" ? console : null;
        if (logger) {
          logger.debug(`[doc-skills-pipeline] Processed document data:`, ...ctx.logs);
          if (ctx.errors.length > 0) {
            logger.warn(`[doc-skills-pipeline] ${ctx.errors.length} non-fatal error(s):`, ctx.errors);
          }
        }
      }
      return ctx;
    }
  };

  // src/shared/doc-skills/doctype-sections.mjs
  var doctypeSectionsSkill = {
    name: "doctype-sections",
    stage: "transform",
    failMode: "graceful",
    run(ctx) {
      const data = ctx.data;
      if (!data) return ctx;
      const docType = data.documentType || "quote";
      if (!data._sectionFlags) data._sectionFlags = {};
      data._sectionFlags.showSignature = docType === "contract" || docType === "workOrder";
      if (data._sectionFlags.showSignature === false) {
        ctx.logs.push(`[doctype-sections] Hiding signature for docType="${docType}"`);
      }
      return ctx;
    }
  };

  // src/shared/clause-resolver.mjs
  function resolveDocTypeKey(documentType) {
    return documentType === "quote" ? "quote" : documentType === "contract" ? "contract" : documentType === "cv" ? "cv" : "workOrder";
  }
  function resolveClauses(clausesDb, opts = {}) {
    const result = {};
    if (!clausesDb || !clausesDb.clauses) return result;
    const {
      documentType = "quote",
      serviceType = "",
      selectedClauses = null,
      clauseEdits = {},
      language = "he"
    } = opts;
    const docTypeKey = resolveDocTypeKey(documentType);
    let relevantClauseIds = null;
    if (serviceType && clausesDb.serviceTemplates) {
      const template = clausesDb.serviceTemplates.find((t) => t.type === serviceType);
      if (template && template.relevantClauses) {
        relevantClauseIds = new Set(template.relevantClauses);
      }
    }
    const hasSelection = Array.isArray(selectedClauses) && selectedClauses.length > 0;
    for (const categoryKey of Object.keys(clausesDb.clauses)) {
      const category = clausesDb.clauses[categoryKey];
      if (!category || !Array.isArray(category.clauses)) continue;
      result[categoryKey] = category.clauses.filter((c) => {
        if (!c.appliesTo || !c.appliesTo.includes(docTypeKey)) return false;
        if (hasSelection) return selectedClauses.includes(c.id);
        if (relevantClauseIds) return relevantClauseIds.has(c.id) || c.required;
        return true;
      }).map((c) => {
        const raw = clauseEdits[c.id] || c.text;
        const text = typeof raw === "object" ? raw[language] || raw.he || raw.en || "" : raw;
        return { id: c.id, text, required: !!c.required, appliesTo: c.appliesTo || [] };
      });
    }
    return result;
  }

  // src/shared/form-validation.mjs
  function normalizeText(s) {
    return String(s || "").replace(/^[•‣⁃◦•·‣\-–—]\s*/, "").toLowerCase().replace(/["'״׳“”‟"'`.,;:!?()\[\]{}־–—\-]/g, " ").replace(/\s+/g, " ").trim();
  }
  function tokens(s) {
    return normalizeText(s).split(" ").filter((w) => w.length >= 2);
  }
  var SIGNATURE_FAMILIES = [
    ['\u05DE\u05E2"\u05DE', "\u05DE\u05E2\u05DE", "\u05DE\u05E2 \u05DE"],
    // VAT
    ["\u05EA\u05D5\u05E7\u05E3", "\u05D1\u05EA\u05D5\u05E7\u05E3"],
    // quote validity
    ["\u05DE\u05E7\u05D3\u05DE\u05D4"],
    // advance payment
    ["\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05EA"]
    // invoicing
  ];
  function familyHits(norm) {
    const hits = /* @__PURE__ */ new Set();
    SIGNATURE_FAMILIES.forEach((fam, i) => {
      if (fam.some((tok) => norm.includes(normalizeText(tok)))) hits.add(i);
    });
    return hits;
  }
  function noteMatchesClause(noteLine, clauseTexts) {
    const noteNorm = normalizeText(noteLine);
    if (!noteNorm) return { redundant: false, clauseText: null };
    const noteTokens = tokens(noteLine);
    const noteFam = familyHits(noteNorm);
    for (const clause of clauseTexts) {
      const clauseNorm = normalizeText(clause);
      if (!clauseNorm) continue;
      if (noteNorm.length >= 8 && (clauseNorm.includes(noteNorm) || noteNorm.includes(clauseNorm))) {
        return { redundant: true, clauseText: clause };
      }
      if (noteTokens.length >= 3) {
        const clauseTokenSet = new Set(tokens(clause));
        const shared = noteTokens.filter((t) => clauseTokenSet.has(t)).length;
        if (shared / noteTokens.length >= 0.7) {
          return { redundant: true, clauseText: clause };
        }
      }
      if (noteFam.size > 0) {
        const clauseFam = familyHits(clauseNorm);
        for (const f of noteFam) {
          if (clauseFam.has(f)) return { redundant: true, clauseText: clause };
        }
      }
    }
    return { redundant: false, clauseText: null };
  }
  function findRedundantNotes(noteLines, clauseTexts) {
    const kept = [];
    const redundant = [];
    for (const line of noteLines) {
      if (!line || !line.trim()) continue;
      const m = noteMatchesClause(line, clauseTexts);
      if (m.redundant) redundant.push({ line, clauseText: m.clauseText });
      else kept.push(line);
    }
    return { kept, redundant };
  }
  function allClauseTexts(resolved) {
    const out = [];
    for (const key of Object.keys(resolved || {})) {
      for (const c of resolved[key]) if (c.text) out.push(c.text);
    }
    return out;
  }

  // src/shared/doc-skills/dedupe-notes.mjs
  var dedupeNotesSkill = {
    name: "dedupe-notes",
    stage: "transform",
    failMode: "graceful",
    run(ctx) {
      const data = ctx.data;
      if (!data || !data.generalNotes || !data._clausesDb) return ctx;
      if (data.documentType === "cv") return ctx;
      const resolved = resolveClauses(data._clausesDb, {
        documentType: data.documentType || "quote",
        serviceType: data.serviceType || "",
        selectedClauses: data.selectedClauses || null,
        clauseEdits: data.clauseEdits || {},
        language: data.userProfile && data.userProfile.language || data.language || "he"
      });
      const clauseTexts = allClauseTexts(resolved);
      if (clauseTexts.length === 0) return ctx;
      const noteLines = data.generalNotes.split("\n").filter((l) => l.trim());
      const { kept, redundant } = findRedundantNotes(noteLines, clauseTexts);
      if (redundant.length > 0) {
        data.generalNotes = kept.join("\n");
        data._notesWarnings = redundant.map((r) => r.line.trim());
        ctx.logs.push(`[dedupe-notes] stripped ${redundant.length} note line(s) duplicating clauses`);
      }
      return ctx;
    }
  };

  // src/shared/doc-skills/index.mjs
  clearSkills();
  registerSkill(trimDescriptionSkill);
  registerSkill(stripOptionPrefixSkill);
  registerSkill(filterMetaTextSkill);
  registerSkill(splitSentencesSkill);
  registerSkill(doctypeSectionsSkill);
  registerSkill(dedupeNotesSkill);
  registerSkill(logTransformsSkill);
  function processDocData(data) {
    const ctx = createDocContext(data);
    const result = runPipeline(ctx);
    return {
      data: result.data,
      logs: result.logs,
      errors: result.errors,
      failed: result.failed,
      failReason: result.failReason
    };
  }

  // src/render-preview.mjs
  function formatPrice(n) {
    return (typeof n === "number" ? n : 0).toLocaleString("he-IL") + " \u20AA";
  }
  function esc(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function normalizeArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string" && value.trim()) return value.split("\n").map((v) => v.trim()).filter(Boolean);
    return [];
  }
  function buildCvFallbackSections(data) {
    const sections = [];
    const timeline = normalizeArray(data.timeline);
    const notes = normalizeArray(data.notes);
    if (timeline.length > 0) sections.push({ title: "\u05E0\u05D9\u05E1\u05D9\u05D5\u05DF / \u05E6\u05D9\u05E8 \u05D6\u05DE\u05DF", items: timeline });
    if (notes.length > 0) sections.push({ title: "\u05DE\u05D9\u05D3\u05E2 \u05E0\u05D5\u05E1\u05E3", items: notes });
    return sections;
  }
  function makeClauseGetter({ clausesDb, documentType, selectedClauses, clauseEdits, relevantClauseIds, language }) {
    return function getClauseTexts(categoryKey) {
      if (!clausesDb || !clausesDb.clauses || !clausesDb.clauses[categoryKey]) return [];
      const docTypeKey = documentType === "quote" ? "quote" : documentType === "contract" ? "contract" : documentType === "cv" ? "cv" : "workOrder";
      return clausesDb.clauses[categoryKey].clauses.filter((c) => {
        if (!c.appliesTo.includes(docTypeKey)) return false;
        if (selectedClauses && Array.isArray(selectedClauses) && selectedClauses.length > 0) {
          return selectedClauses.includes(c.id);
        }
        if (relevantClauseIds) {
          return relevantClauseIds.has(c.id) || c.required;
        }
        return true;
      }).map((c) => {
        const text = clauseEdits && clauseEdits[c.id] || c.text;
        return typeof text === "object" ? text[language] || text.he || text.en || "" : text;
      });
    };
  }
  var PREVIEW_CSS = `
<style>
.doc-preview {
  font-family: 'Heebo', Arial, sans-serif;
  font-size: 11pt;
  color: #1a1a1a;
  background: #fff;
  max-width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 22mm 24mm 26mm 24mm;
  box-shadow: 0 1px 6px rgba(0,0,0,0.10);
  line-height: 1.6;
  box-sizing: border-box;
}
.doc-date {
  margin: 0 0 4px 0;
  font-size: 11pt;
}
.doc-title {
  text-align: center;
  font-size: 22pt;
  font-weight: 700;
  margin: 0 0 4px 0;
}
.doc-subtitle {
  text-align: center;
  font-size: 13pt;
  margin: 0 0 20px 0;
}
.doc-from-to {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12px;
}
.doc-from-to td {
  background: #D6E4F0;
  padding: 6px 10px;
  border: 1px solid #9BB7D6;
  width: 50%;
}
.doc-section {
  margin-bottom: 8px;
}
.doc-section-header {
  background: #D6E4F0;
  border-top: 1px solid #9BB7D6;
  border-bottom: 1px solid #9BB7D6;
  padding: 4px 8px;
  font-size: 14pt;
  font-weight: 700;
  margin: 18px 0 10px 0;
}
.doc-bullets {
  margin: 0 20px 0 0;
  padding: 0 20px 0 0;
  list-style: disc;
}
.doc-bullets li {
  margin-bottom: 4px;
}
.doc-dash-list {
  margin: 0 20px 0 0;
  padding: 0 20px 0 0;
  list-style: '\\2022  ';
}
.doc-dash-list li {
  margin-bottom: 4px;
  text-align: justify;
}
.doc-pricing-table,
.doc-payment-table,
.doc-options-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 8px;
}
.doc-pricing-table th,
.doc-pricing-table td,
.doc-payment-table th,
.doc-payment-table td,
.doc-options-table th,
.doc-options-table td {
  border: 1px solid #BFBFBF;
  padding: 5px 8px;
}
.doc-pricing-table thead th,
.doc-options-table thead th {
  background: #D6E4F0;
  font-weight: 700;
}
.doc-pricing-table tfoot td {
  font-weight: 700;
  background: #D6E4F0;
}
.doc-option-label {
  font-weight: 700;
  font-size: 12pt;
  margin: 12px 0 6px 0;
}
.doc-paragraph {
  margin: 0 0 6px 0;
  text-align: justify;
}
.doc-signature {
  margin-top: 30px;
  text-align: center;
}
.doc-signature-title {
  font-weight: 700;
  font-size: 11pt;
  margin-bottom: 20px;
}
.doc-sig-table {
  width: 100%;
  border-collapse: collapse;
}
.doc-sig-table td {
  text-align: center;
  padding: 8px;
  border: none;
  width: 33%;
}
.doc-sig-line {
  border-bottom: 1px solid #333;
  display: inline-block;
  width: 80%;
  margin-bottom: 4px;
}
.doc-sig-label {
  font-size: 10pt;
  color: #555;
}
.doc-footer {
  margin-top: 30px;
  padding-top: 8px;
  border-top: 1px solid #BFBFBF;
  font-size: 9pt;
  color: #555;
}
.doc-footer-info p {
  margin: 0;
  text-align: left;
}
.doc-footer-info .footer-name {
  font-weight: 700;
}
.cv-header {
  text-align: center;
  margin-bottom: 18px;
}
.cv-name {
  font-size: 26pt;
  font-weight: 700;
  margin: 0 0 2px 0;
  color: #111827;
}
.cv-headline {
  margin: 0 0 6px 0;
  color: #374151;
  font-size: 12.5pt;
}
.cv-contact {
  direction: ltr;
  unicode-bidi: plaintext;
  color: #374151;
  font-size: 9.5pt;
  margin: 0;
}
.cv-section-title {
  border-bottom: 2px solid #0F6674;
  color: #0F6674;
  font-size: 13pt;
  font-weight: 700;
  margin: 16px 0 8px 0;
  padding-bottom: 3px;
}
.cv-role {
  font-weight: 700;
  margin: 8px 0 3px 0;
}
.cv-list {
  margin: 0 20px 0 0;
  padding: 0 20px 0 0;
}
.cv-list li {
  margin-bottom: 3px;
}
</style>
`;
  function renderCvPreviewHTML(data) {
    const cv = data.cvData || {};
    const fullName = cv.fullName || data.clientName || data.userProfile?.nameEn || data.userProfile?.name || "\u05E7\u05D5\u05E8\u05D5\u05EA \u05D7\u05D9\u05D9\u05DD";
    const headline = cv.headline || data.projectDescription || data.userProfile?.title || "";
    const location = cv.location || "";
    const profile = cv.profile || data.serviceDetails || "";
    const phone = cv.phone || data.userProfile?.phone || "";
    const email = cv.email || data.userProfile?.email || "";
    const website = cv.website || data.userProfile?.website || "";
    const links = Array.isArray(cv.links) ? cv.links : [];
    const sections = normalizeArray(cv.sections);
    const fallbackSections = sections.length > 0 ? [] : buildCvFallbackSections(data);
    const contactParts = [phone, email, website, ...links.map((link) => link.url ? `${link.label || ""}: ${link.url}`.trim() : link.label).filter(Boolean)];
    const parts = [PREVIEW_CSS, '<div class="doc-preview" dir="rtl">'];
    parts.push('<header class="cv-header">');
    parts.push(`<h1 class="cv-name">${esc(fullName)}</h1>`);
    if (headline || location) parts.push(`<p class="cv-headline">${esc([headline, location].filter(Boolean).join(" \xB7 "))}</p>`);
    if (contactParts.length > 0) parts.push(`<p class="cv-contact">${contactParts.map(esc).join(" \xB7 ")}</p>`);
    parts.push("</header>");
    if (profile) {
      parts.push("<section>");
      parts.push('<h2 class="cv-section-title">\u05E4\u05E8\u05D5\u05E4\u05D9\u05DC</h2>');
      parts.push(`<p class="doc-paragraph">${esc(profile)}</p>`);
      parts.push("</section>");
    }
    for (const section of [...sections, ...fallbackSections]) {
      if (!section || !section.title) continue;
      parts.push("<section>");
      parts.push(`<h2 class="cv-section-title">${esc(section.title)}</h2>`);
      for (const item of normalizeArray(section.items)) {
        if (typeof item === "string") {
          parts.push(`<ul class="cv-list"><li>${esc(item)}</li></ul>`);
          continue;
        }
        const role = [item.title, item.organization].filter(Boolean).join(" \u2014 ");
        const roleLine = item.dates || item.date ? `${role}   ${item.dates || item.date}` : role;
        if (roleLine) parts.push(`<p class="cv-role">${esc(roleLine)}</p>`);
        const bullets = normalizeArray(item.bullets || item.details || item.description);
        if (bullets.length > 0) {
          parts.push('<ul class="cv-list">');
          bullets.forEach((bullet) => parts.push(`<li>${esc(bullet)}</li>`));
          parts.push("</ul>");
        }
      }
      parts.push("</section>");
    }
    const skills2 = normalizeArray(cv.skills);
    if (skills2.length > 0) {
      parts.push('<section><h2 class="cv-section-title">\u05DB\u05D9\u05E9\u05D5\u05E8\u05D9\u05DD \u05D5\u05DB\u05DC\u05D9\u05DD</h2><ul class="cv-list">');
      for (const skillGroup of skills2) {
        if (typeof skillGroup === "string") {
          parts.push(`<li>${esc(skillGroup)}</li>`);
        } else {
          const items = normalizeArray(skillGroup.items).join(", ");
          const line = [skillGroup.category, items].filter(Boolean).join(" \u2014 ");
          if (line) parts.push(`<li>${esc(line)}</li>`);
        }
      }
      parts.push("</ul></section>");
    }
    const languages = normalizeArray(cv.languages);
    if (languages.length > 0) {
      parts.push('<section><h2 class="cv-section-title">\u05E9\u05E4\u05D5\u05EA</h2><ul class="cv-list">');
      languages.forEach((language) => parts.push(`<li>${esc(language)}</li>`));
      parts.push("</ul></section>");
    }
    parts.push("</div>");
    return parts.join("\n");
  }
  function renderPreviewHTML(data, options = {}) {
    if (options.clausesDb) data._clausesDb = options.clausesDb;
    processDocData(data);
    const {
      clientName = "",
      clientCompany = "",
      documentType = "quote",
      projectDescription = "",
      serviceDetails = "",
      pricingItems = [],
      paymentTerms = { type: "two", installments: [] },
      timeline = "",
      generalNotes = "",
      date = null,
      serviceType = "",
      selectedClauses = null,
      clauseEdits = {},
      userProfile = {}
    } = data;
    const language = userProfile.language || "he";
    if (documentType === "cv") {
      return renderCvPreviewHTML(data);
    }
    const clausesDb = options.clausesDb || null;
    let relevantClauseIds = null;
    if (serviceType && clausesDb && clausesDb.serviceTemplates) {
      const template = clausesDb.serviceTemplates.find((t) => t.type === serviceType);
      if (template && template.relevantClauses) {
        relevantClauseIds = new Set(template.relevantClauses);
      }
    }
    const getClauseTexts = makeClauseGetter({ clausesDb, documentType, selectedClauses, clauseEdits, relevantClauseIds, language });
    const today = date || (/* @__PURE__ */ new Date()).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" });
    const titleMap = { quote: "\u05D4\u05E6\u05E2\u05EA \u05DE\u05D7\u05D9\u05E8", contract: "\u05D7\u05D5\u05D6\u05D4 \u05E2\u05D1\u05D5\u05D3\u05D4", workOrder: "\u05D4\u05D6\u05DE\u05E0\u05EA \u05E2\u05D1\u05D5\u05D3\u05D4", cv: "\u05E7\u05D5\u05E8\u05D5\u05EA \u05D7\u05D9\u05D9\u05DD" };
    const docTitle = titleMap[documentType] || "\u05D4\u05E6\u05E2\u05EA \u05DE\u05D7\u05D9\u05E8";
    const hasOptions = pricingItems.some((item) => item.option != null && String(item.option).trim() !== "");
    let sharedItems = [];
    let optionGroups = {};
    if (hasOptions) {
      for (const item of pricingItems) {
        const opt = item.option != null ? String(item.option).trim() : "";
        if (opt === "") {
          sharedItems.push(item);
        } else {
          if (!optionGroups[opt]) optionGroups[opt] = [];
          optionGroups[opt].push(item);
        }
      }
    }
    const totalBeforeVat = hasOptions ? 0 : pricingItems.reduce((sum, item) => sum + (item.quantity || 1) * (item.unitPrice || 0), 0);
    const parts = [];
    parts.push(PREVIEW_CSS);
    parts.push('<div class="doc-preview" dir="rtl">');
    parts.push(`<p class="doc-date">\u05EA\u05D0\u05E8\u05D9\u05DA ${esc(today)}</p>`);
    parts.push(`<h1 class="doc-title">${esc(docTitle)} &ndash;</h1>`);
    if (projectDescription) {
      parts.push(`<p class="doc-subtitle">${esc(projectDescription)}</p>`);
    }
    parts.push('<table class="doc-from-to">');
    parts.push("<tr>");
    parts.push(`<td><strong>\u05DE\u05D0\u05EA:</strong> ${esc(userProfile.nameEn || userProfile.name || "")}</td>`);
    parts.push(`<td><strong>\u05DC\u05DB\u05D1\u05D5\u05D3:</strong> ${esc(clientName)}</td>`);
    parts.push("</tr>");
    parts.push("<tr>");
    parts.push(`<td>${esc(userProfile.company || "")}</td>`);
    parts.push(`<td>${esc(clientCompany || "")}</td>`);
    parts.push("</tr>");
    parts.push("</table>");
    if (serviceDetails) {
      parts.push('<div class="doc-section">');
      parts.push('<h2 class="doc-section-header">\u05E4\u05D9\u05E8\u05D5\u05D8 \u05D4\u05E9\u05D9\u05E8\u05D5\u05EA</h2>');
      const lines = serviceDetails.split("\n").filter((l) => l.trim());
      const sdOptions = [];
      const plainLines = [];
      let currentOpt = null;
      for (const line of lines) {
        const optMatch = line.match(/^אופציה\s*(\d+)\s*[–—\-:]\s*(.*)/);
        if (optMatch) {
          let title = optMatch[2].trim().replace(/^אופציה\s*\d+\s*[–—\-:]\s*/, "").trim();
          const titleSentences = title.split(/(?<=\.)\s+/).filter((s) => s.trim());
          const mainTitle = titleSentences[0] || title;
          const extraDetails = titleSentences.slice(1);
          currentOpt = { label: `\u05D0\u05D5\u05E4\u05E6\u05D9\u05D4 ${optMatch[1]}`, title: mainTitle, details: [...extraDetails] };
          sdOptions.push(currentOpt);
        } else if (currentOpt) {
          const cleaned = line.replace(/^[•\-]\s*/, "");
          const sentences = cleaned.split(/(?<=\.)\s+/).filter((s) => s.trim());
          if (sentences.length > 1) {
            sentences.forEach((s) => currentOpt.details.push(s.trim()));
          } else {
            currentOpt.details.push(cleaned);
          }
        } else {
          plainLines.push(line);
        }
      }
      for (const line of plainLines) {
        if (sdOptions.length > 0 && /אופציו?ת.*לבחירה|יש לבחור/i.test(line)) continue;
        if (line.startsWith("\u2022") || line.startsWith("-")) {
          parts.push(`<ul class="doc-dash-list"><li>${esc(line.replace(/^[•\-]\s*/, ""))}</li></ul>`);
        } else {
          parts.push(`<p class="doc-paragraph">${esc(line)}</p>`);
        }
      }
      if (sdOptions.length > 0) {
        parts.push('<table class="doc-options-table">');
        parts.push('<thead><tr><th style="width:20%">\u05D0\u05D5\u05E4\u05E6\u05D9\u05D4</th><th style="width:80%">\u05E4\u05D9\u05E8\u05D5\u05D8</th></tr></thead>');
        parts.push("<tbody>");
        for (const opt of sdOptions) {
          const detailHtml = (opt.title ? `<strong>${esc(opt.title)}</strong><br>` : "") + opt.details.map((d) => `<span>&#8226; ${esc(d)}</span>`).join("<br>");
          parts.push(`<tr><td><strong>${esc(opt.label)}</strong></td><td>${detailHtml}</td></tr>`);
        }
        parts.push("</tbody></table>");
      }
      parts.push("</div>");
    }
    if (pricingItems.length > 0) {
      parts.push('<div class="doc-section">');
      parts.push('<h2 class="doc-section-header">\u05E2\u05DC\u05D5\u05EA</h2>');
      if (hasOptions) {
        if (sharedItems.length > 0) {
          parts.push(buildPricingTableHTML(sharedItems));
        }
        for (const [optKey, optItems] of Object.entries(optionGroups)) {
          const firstDesc = optItems[0] && optItems[0].description ? optItems[0].description : "";
          const optionLabel = firstDesc ? `\u05D0\u05D5\u05E4\u05E6\u05D9\u05D4 ${optKey} \u2014 ${firstDesc}` : `\u05D0\u05D5\u05E4\u05E6\u05D9\u05D4 ${optKey}`;
          parts.push(`<p class="doc-option-label">${esc(optionLabel)}</p>`);
          const tableItems = [...sharedItems, ...optItems];
          parts.push(buildPricingTableHTML(tableItems));
        }
      } else {
        parts.push(buildPricingTableHTML(pricingItems));
      }
      parts.push("</div>");
    }
    if (paymentTerms && paymentTerms.installments && paymentTerms.installments.length > 0) {
      parts.push('<div class="doc-section">');
      parts.push('<h2 class="doc-section-header">\u05EA\u05DE\u05D5\u05E8\u05D4 \u05D5\u05EA\u05E0\u05D0\u05D9 \u05EA\u05E9\u05DC\u05D5\u05DD</h2>');
      const paymentTotals = [];
      if (hasOptions) {
        for (const [optKey, optItems] of Object.entries(optionGroups)) {
          const shared = sharedItems.reduce((s, i) => s + (i.quantity || 1) * (i.unitPrice || 0), 0);
          const optTotal = optItems.reduce((s, i) => s + (i.quantity || 1) * (i.unitPrice || 0), 0) + shared;
          paymentTotals.push({ label: `\u05D0\u05D5\u05E4\u05E6\u05D9\u05D4 ${optKey}`, total: optTotal });
        }
      } else if (totalBeforeVat > 0) {
        paymentTotals.push({ label: null, total: totalBeforeVat });
      }
      const totalsToShow = paymentTotals.length > 0 ? paymentTotals : [{ label: null, total: 0 }];
      const installs = paymentTerms.installments;
      for (const pt of totalsToShow) {
        if (pt.label && paymentTotals.length > 1) {
          parts.push(`<p style="font-weight:700;margin:10px 0 6px 0;">${esc(pt.label)}</p>`);
        }
        parts.push('<table class="doc-payment-table"><tr>');
        for (const inst of installs) {
          const pct = inst.percentage;
          const amount = pt.total > 0 ? Math.round(pt.total * pct / 100) : 0;
          const amountStr = amount > 0 ? ` \u05D1\u05E1\u05DA \u05E9\u05DC ${formatPrice(amount)} + \u05DE\u05E2"\u05DE` : "";
          const text = `${inst.description} \u2013 ${pct}%${amountStr}`;
          parts.push(`<td>&#8226; ${esc(text)}</td>`);
        }
        parts.push("</tr></table>");
      }
      if (clausesDb) {
        const paymentClauses = getClauseTexts("paymentTerms");
        if (paymentClauses.length > 0) {
          parts.push('<ul class="doc-dash-list">');
          paymentClauses.forEach((text) => parts.push(`<li>${esc(text)}</li>`));
          parts.push("</ul>");
        }
      }
      const invoiceClauseSelected = selectedClauses && selectedClauses.includes("payment-invoice");
      if (!invoiceClauseSelected) {
        parts.push('<ul class="doc-dash-list"><li>\u05DC\u05D0\u05D7\u05E8 \u05E7\u05D1\u05DC\u05EA \u05D4\u05EA\u05E9\u05DC\u05D5\u05DD \u05D4\u05DE\u05DC\u05D0 \u05EA\u05D9\u05E9\u05DC\u05D7 \u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05EA \u05DE\u05E1.</li></ul>');
      }
      parts.push("</div>");
    }
    if (timeline) {
      parts.push('<div class="doc-section">');
      parts.push('<h2 class="doc-section-header">\u05DC\u05D5\u05D7\u05D5\u05EA \u05D6\u05DE\u05E0\u05D9\u05DD</h2>');
      parts.push('<ul class="doc-dash-list">');
      const timelineLines = timeline.split("\n").filter((l) => l.trim());
      for (const line of timelineLines) {
        parts.push(`<li>${esc(line.replace(/^[•\-]\s*/, ""))}</li>`);
      }
      parts.push("</ul></div>");
    }
    const clauseSections = [
      { key: "clientObligations", title: "\u05D4\u05EA\u05D7\u05D9\u05D9\u05D1\u05D5\u05D9\u05D5\u05EA \u05D4\u05DC\u05E7\u05D5\u05D7", style: "dash" },
      { key: "earlyTermination", title: "\u05D4\u05E4\u05E1\u05E7\u05EA \u05E2\u05D1\u05D5\u05D3\u05D4 \u05DE\u05D5\u05E7\u05D3\u05DE\u05EA", style: "dash" },
      { key: "revisions", title: "\u05EA\u05D9\u05E7\u05D5\u05E0\u05D9\u05DD \u05D5\u05D4\u05E2\u05E8\u05D5\u05EA", style: "dash" },
      { key: "deliveryProcess", title: "\u05EA\u05D4\u05DC\u05D9\u05DA \u05E1\u05D9\u05D5\u05DD \u05D5\u05DE\u05E1\u05D9\u05E8\u05D4", style: "dash" },
      { key: "intellectualProperty", title: "\u05E7\u05E0\u05D9\u05D9\u05DF \u05E8\u05D5\u05D7\u05E0\u05D9, \u05E8\u05D9\u05E9\u05D5\u05D9 \u05D5\u05D0\u05D7\u05E8\u05D9\u05D5\u05EA", style: "paragraph" },
      { key: "aiDisclaimers", title: "\u05D4\u05E6\u05D4\u05E8\u05D5\u05EA \u05DC\u05E7\u05D5\u05D7 (AI \u05D2\u05E0\u05E8\u05D8\u05D9\u05D1\u05D9)", style: "paragraph" },
      { key: "warrantyAndCompletion", title: '\u05D4\u05D2\u05D3\u05E8\u05EA "\u05E1\u05D9\u05D5\u05DD" \u05D5\u05EA\u05E7\u05D5\u05E4\u05EA \u05D0\u05D7\u05E8\u05D9\u05D5\u05EA', style: "paragraph" },
      { key: "commercialResponsibility", title: "\u05D0\u05D7\u05E8\u05D9\u05D5\u05EA \u05DC\u05E9\u05D9\u05DE\u05D5\u05E9 \u05DE\u05E1\u05D7\u05E8\u05D9", style: "paragraph" },
      { key: "confidentiality", title: "\u05E1\u05D5\u05D3\u05D9\u05D5\u05EA", style: "paragraph" },
      { key: "projectTermination", title: "\u05E1\u05D9\u05D5\u05DD \u05D4\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8", style: "dash" },
      { key: "generalTerms", title: "\u05EA\u05E0\u05D0\u05D9\u05DD \u05DB\u05DC\u05DC\u05D9\u05D9\u05DD", style: "paragraph" }
    ];
    for (const section of clauseSections) {
      const clauseTexts = getClauseTexts(section.key);
      if (clauseTexts.length > 0) {
        parts.push('<div class="doc-section">');
        parts.push(`<h2 class="doc-section-header">${esc(section.title)}</h2>`);
        if (section.style === "dash") {
          parts.push('<ul class="doc-dash-list">');
          clauseTexts.forEach((text) => parts.push(`<li>${esc(text)}</li>`));
          parts.push("</ul>");
        } else {
          clauseTexts.forEach((text) => parts.push(`<p class="doc-paragraph">${esc(text)}</p>`));
        }
        parts.push("</div>");
      }
    }
    if (generalNotes) {
      let noteLines = generalNotes.split("\n").filter((l) => l.trim());
      if (noteLines.length === 1 && noteLines[0].includes(". ")) {
        noteLines = noteLines[0].split(/\.\s+/).filter((l) => l.trim()).map((l) => l.endsWith(".") ? l : l + ".");
      }
      if (noteLines.length > 0) {
        parts.push('<div class="doc-section">');
        parts.push('<h2 class="doc-section-header">\u05D4\u05E2\u05E8\u05D5\u05EA \u05DB\u05DC\u05DC\u05D9\u05D5\u05EA</h2>');
        parts.push('<ul class="doc-dash-list">');
        for (const line of noteLines) {
          parts.push(`<li>${esc(line.replace(/^[•\-]\s*/, ""))}</li>`);
        }
        parts.push("</ul></div>");
      }
    }
    const showSignature = data._sectionFlags?.showSignature !== false ? documentType === "contract" || documentType === "workOrder" : data._sectionFlags.showSignature;
    if (showSignature) {
      parts.push('<div class="doc-signature">');
      const signatureBindingInTerms = selectedClauses && selectedClauses.includes("general-signature-binding");
      if (!signatureBindingInTerms) {
        parts.push('<p class="doc-signature-title">\u05D7\u05EA\u05D9\u05DE\u05D4 \u05E2\u05DC \u05DE\u05E1\u05DE\u05DA \u05D6\u05D4 \u05DE\u05D4\u05D5\u05D5\u05D4 \u05D0\u05D9\u05E9\u05D5\u05E8 \u05D5\u05D4\u05EA\u05D7\u05D9\u05D9\u05D1\u05D5\u05EA \u05DC\u05DB\u05DC \u05D4\u05E8\u05E9\u05D5\u05DD \u05DC\u05E2\u05D9\u05DC</p>');
      }
      parts.push('<table class="doc-sig-table">');
      parts.push("<tr>");
      parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">\u05E9\u05DD \u05D4\u05DC\u05E7\u05D5\u05D7</div></td>');
      parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">\u05D7\u05EA\u05D9\u05DE\u05D4 \u05D5\u05D7\u05D5\u05EA\u05DE\u05EA</div></td>');
      parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">\u05EA\u05D0\u05E8\u05D9\u05DA</div></td>');
      parts.push("</tr>");
      parts.push("<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>");
      parts.push("<tr>");
      parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">\u05E9\u05DD \u05DE\u05D1\u05E6\u05E2 \u05D4\u05E2\u05D1\u05D5\u05D3\u05D4</div></td>');
      parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">\u05D7\u05EA\u05D9\u05DE\u05D4 \u05D5\u05D7\u05D5\u05EA\u05DE\u05EA</div></td>');
      parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">\u05EA\u05D0\u05E8\u05D9\u05DA</div></td>');
      parts.push("</tr>");
      parts.push("</table></div>");
    }
    parts.push('<div class="doc-footer">');
    parts.push('<div class="doc-footer-info">');
    if (userProfile.name) {
      parts.push(`<p class="footer-name">${esc(userProfile.name)}</p>`);
    }
    if (userProfile.title) {
      parts.push(`<p>${esc(userProfile.title)}</p>`);
    }
    const contactLine = [userProfile.email, userProfile.website].filter(Boolean).join(" | ");
    if (contactLine) {
      parts.push(`<p>${esc(contactLine)}</p>`);
    }
    if (userProfile.phone) {
      parts.push(`<p>${esc(userProfile.phone)}</p>`);
    }
    parts.push("</div></div>");
    parts.push("</div>");
    return parts.join("\n");
  }
  function buildPricingTableHTML(items) {
    const subtotal = items.reduce((sum, item) => sum + (item.quantity || 1) * (item.unitPrice || 0), 0);
    const rows = items.map((item) => {
      const total = (item.quantity || 1) * (item.unitPrice || 0);
      return `<tr>
      <td>${esc(item.description || "")}</td>
      <td>${item.quantity || 1}</td>
      <td>${formatPrice(item.unitPrice || 0)}</td>
      <td>${formatPrice(total)}</td>
    </tr>`;
    }).join("\n");
    return `<table class="doc-pricing-table">
<thead><tr><th style="width:45%">\u05E4\u05D9\u05E8\u05D5\u05D8</th><th style="width:15%">\u05DB\u05DE\u05D5\u05EA</th><th style="width:20%">\u05DE\u05D7\u05D9\u05E8 \u05DC\u05D9\u05D7\u05D9\u05D3\u05D4</th><th style="width:20%">\u05E1\u05D4"\u05DB</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td></td><td></td><td>\u05E1\u05D4"\u05DB \u05DC\u05E4\u05E0\u05D9 \u05DE\u05E2"\u05DE</td><td>${formatPrice(subtotal)}</td></tr></tfoot>
</table>`;
  }
  return __toCommonJS(render_preview_exports);
})();
