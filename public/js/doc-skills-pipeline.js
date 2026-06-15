var DocSkillsPipeline = (() => {
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

  // src/shared/doc-skills/index.mjs
  var index_exports = {};
  __export(index_exports, {
    clearSkills: () => clearSkills,
    createDocContext: () => createDocContext,
    processDocData: () => processDocData,
    registerSkill: () => registerSkill,
    runPipeline: () => runPipeline
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
  function noteMatchesClause(noteLine, clauseTexts) {
    const noteNorm = normalizeText(noteLine);
    if (!noteNorm) return { redundant: false, clauseText: null };
    const noteTokens = tokens(noteLine);
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
  return __toCommonJS(index_exports);
})();
