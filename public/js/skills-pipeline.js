var SkillsPipeline = (() => {
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

  // src/shared/skills/index.mjs
  var index_exports = {};
  __export(index_exports, {
    clearSkills: () => clearSkills,
    createContext: () => createContext,
    processAIOutput: () => processAIOutput,
    registerSkill: () => registerSkill,
    runPipeline: () => runPipeline
  });

  // src/shared/skills/context.mjs
  function createContext(rawText, type) {
    return {
      rawText,
      type,
      json: null,
      snapshot: null,
      logs: [],
      errors: [],
      failed: false,
      failReason: null
    };
  }

  // src/shared/skills/registry.mjs
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
  var DEFAULT_STAGES = ["parse", "validate", "transform", "log"];
  async function runPipeline(ctx, stages) {
    const stageOrder = stages || DEFAULT_STAGES;
    for (const stage of stageOrder) {
      for (const skill of getSkills(stage)) {
        try {
          ctx = await skill.run(ctx);
        } catch (err) {
          if (skill.failMode === "critical") {
            ctx.failed = true;
            ctx.failReason = `[${skill.name}] ${err.message}`;
            ctx.errors.push(err);
            return ctx;
          }
          ctx.errors.push(err);
          ctx.logs.push(`[${skill.name}] WARN: ${err.message} \u2014 skipped`);
        }
      }
    }
    return ctx;
  }

  // src/shared/skills/parse-json.mjs
  function repairJson(text) {
    let repaired = text;
    repaired = repaired.replace(/(\p{Script=Hebrew})"(\p{Script=Hebrew})/gu, "$1\u05F4$2");
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");
    repaired = repaired.replace(/(?<=:\s*"[^"]*)\n([^"]*")/g, "\\n$1");
    const opens = (repaired.match(/[{[]/g) || []).length;
    const closes = (repaired.match(/[}\]]/g) || []).length;
    const diff = opens - closes;
    if (diff > 0) {
      for (let i = 0; i < diff; i++) {
        const lastOpen = repaired.lastIndexOf("[") > repaired.lastIndexOf("{") ? "]" : "}";
        repaired += lastOpen;
      }
    }
    return repaired;
  }
  var parseJsonSkill = {
    name: "parse-json",
    stage: "parse",
    failMode: "critical",
    run(ctx) {
      try {
        ctx.json = JSON.parse(ctx.rawText);
        return ctx;
      } catch (directErr) {
        ctx.logs.push(`[parse-json] Direct parse failed: ${directErr.message}. Attempting repair...`);
      }
      try {
        const repaired = repairJson(ctx.rawText);
        ctx.json = JSON.parse(repaired);
        ctx.logs.push("[parse-json] Repaired JSON successfully");
        return ctx;
      } catch (repairErr) {
        throw new Error(`JSON parse failed even after repair: ${repairErr.message}`);
      }
    }
  };

  // src/shared/skills/validate-schema.mjs
  var VALID_ACTION_TYPES = /* @__PURE__ */ new Set([
    "addClause",
    "removeClause",
    "editClause",
    "updateField",
    "addPricingRow",
    "removePricingRow",
    "updatePricingRow",
    "setPayment",
    "toggleSection"
  ]);
  function validateFormData(data) {
    const errors = [];
    if (data.pricingItems != null && !Array.isArray(data.pricingItems)) {
      errors.push("pricingItems must be an array");
    }
    if (Array.isArray(data.pricingItems)) {
      data.pricingItems.forEach((item, i) => {
        if (item.price != null && typeof item.price !== "number") {
          const num = Number(item.price);
          if (!isNaN(num)) {
            item.price = num;
          } else {
            errors.push(`pricingItems[${i}].price is not a valid number: ${item.price}`);
          }
        }
        if (item.qty != null && typeof item.qty !== "number") {
          const num = Number(item.qty);
          if (!isNaN(num)) {
            item.qty = num;
          }
        }
      });
    }
    return errors;
  }
  function validateFormUpdate(data) {
    const errors = [];
    if (!Array.isArray(data.actions)) {
      errors.push("FORM_UPDATE must have an actions array");
      return errors;
    }
    data.actions.forEach((action, i) => {
      if (!action || !action.type) {
        errors.push(`actions[${i}] missing type`);
        return;
      }
      if (!VALID_ACTION_TYPES.has(action.type)) {
        errors.push(`actions[${i}] unknown type: ${action.type}`);
      }
    });
    return errors;
  }
  var validateSchemaSkill = {
    name: "validate-schema",
    stage: "validate",
    failMode: "critical",
    run(ctx) {
      if (!ctx.json) {
        throw new Error("No JSON to validate (parse stage may have failed)");
      }
      const errors = ctx.type === "FORM_DATA" ? validateFormData(ctx.json) : validateFormUpdate(ctx.json);
      if (errors.length > 0) {
        throw new Error(`Schema validation failed: ${errors.join("; ")}`);
      }
      try {
        ctx.snapshot = structuredClone(ctx.json);
      } catch {
        ctx.snapshot = JSON.parse(JSON.stringify(ctx.json));
      }
      ctx.logs.push(`[validate-schema] ${ctx.type} validated OK`);
      return ctx;
    }
  };

  // src/shared/skills/detect-options.mjs
  var OPTION_RE = /אופציה\s*(\d+)/;
  function detectOptionFromDesc(desc) {
    if (typeof desc !== "string") return null;
    const m = desc.match(OPTION_RE);
    return m ? m[1] : null;
  }
  function processPricingItems(items, logs) {
    if (!Array.isArray(items)) return;
    let count = 0;
    items.forEach((item) => {
      if (!item) return;
      const desc = item.desc || item.description || "";
      if (!item.option || String(item.option).trim() === "") {
        const detected = detectOptionFromDesc(desc);
        if (detected) {
          item.option = detected;
          count++;
          logs.push(`[detect-options] Set option=${detected} on: "${desc.slice(0, 40)}..."`);
        }
      }
    });
    return count;
  }
  var detectOptionsSkill = {
    name: "detect-options",
    stage: "transform",
    failMode: "graceful",
    run(ctx) {
      const data = ctx.json;
      if (!data) return ctx;
      if (ctx.type === "FORM_DATA" && data.pricingItems) {
        processPricingItems(data.pricingItems, ctx.logs);
      }
      if (ctx.type === "FORM_UPDATE" && Array.isArray(data.actions)) {
        data.actions.forEach((action) => {
          if (!action) return;
          if ((action.type === "addPricingRow" || action.type === "updatePricingRow") && (!action.option || String(action.option).trim() === "")) {
            const detected = detectOptionFromDesc(action.desc || action.description || "");
            if (detected) {
              action.option = detected;
              ctx.logs.push(`[detect-options] Set option=${detected} on action: ${action.type}`);
            }
          }
        });
      }
      return ctx;
    }
  };

  // src/shared/skills/format-text-fields.mjs
  var TEXT_FIELDS = ["notes", "serviceDetails", "timeline"];
  function enforceNewlines(value) {
    if (typeof value !== "string" || !value) return value;
    if (value.includes("\n")) return value;
    if (!value.includes(". ")) return value;
    const parts = value.split(". ").map((s) => s.trim()).filter(Boolean).map((s) => s.endsWith(".") ? s : s + ".");
    return parts.join("\n");
  }
  var formatTextFieldsSkill = {
    name: "format-text-fields",
    stage: "transform",
    failMode: "graceful",
    run(ctx) {
      const data = ctx.json;
      if (!data) return ctx;
      if (ctx.type === "FORM_DATA") {
        for (const field of TEXT_FIELDS) {
          if (typeof data[field] === "string") {
            const original = data[field];
            data[field] = enforceNewlines(data[field]);
            if (data[field] !== original) {
              const lineCount = data[field].split("\n").length;
              ctx.logs.push(`[format-text-fields] Split ${field} into ${lineCount} lines`);
            }
          }
        }
      }
      if (ctx.type === "FORM_UPDATE" && Array.isArray(data.actions)) {
        data.actions.forEach((action) => {
          if (action && action.type === "updateField" && TEXT_FIELDS.includes(action.field)) {
            const original = action.value;
            action.value = enforceNewlines(action.value);
            if (action.value !== original) {
              const lineCount = action.value.split("\n").length;
              ctx.logs.push(`[format-text-fields] Split ${action.field} into ${lineCount} lines`);
            }
          }
        });
      }
      return ctx;
    }
  };

  // src/shared/skills/trim-description.mjs
  var MAX_LENGTH = 80;
  function splitAtFirstSentence(text) {
    const separatorMatch = text.match(/[.]\s|\n/);
    if (separatorMatch && separatorMatch.index < MAX_LENGTH) {
      const idx = separatorMatch.index + 1;
      return {
        title: text.slice(0, idx).trim(),
        rest: text.slice(idx).replace(/^[\s.]+/, "").trim()
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
      const data = ctx.json;
      if (!data) return ctx;
      if (ctx.type === "FORM_DATA" && typeof data.projectDescription === "string" && data.projectDescription.length > MAX_LENGTH) {
        const original = data.projectDescription;
        const { title, rest } = splitAtFirstSentence(original);
        data.projectDescription = title;
        if (rest) {
          data.serviceDetails = rest + (data.serviceDetails ? "\n" + data.serviceDetails : "");
        }
        ctx.logs.push(`[trim-description] Trimmed projectDescription from ${original.length} to ${title.length} chars`);
      }
      if (ctx.type === "FORM_UPDATE" && Array.isArray(data.actions)) {
        data.actions.forEach((action) => {
          if (action && action.type === "updateField" && action.field === "projectDescription" && typeof action.value === "string" && action.value.length > MAX_LENGTH) {
            const original = action.value;
            const { title } = splitAtFirstSentence(original);
            action.value = title;
            ctx.logs.push(`[trim-description] Trimmed updateField projectDescription from ${original.length} to ${title.length} chars`);
          }
        });
      }
      return ctx;
    }
  };

  // src/shared/skills/log-transforms.mjs
  function isLoggingEnabled() {
    if (typeof window !== "undefined") {
      return window.__SKILLS_LOG !== false;
    }
    if (typeof process !== "undefined" && process.env) {
      return process.env.SKILLS_LOG !== "0";
    }
    return true;
  }
  function diffObjects(before, after, prefix = "") {
    const changes = [];
    if (!before || !after) return changes;
    const allKeys = /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const bVal = before[key];
      const aVal = after[key];
      if (typeof bVal === "string" && typeof aVal === "string" && bVal !== aVal) {
        if (bVal.length > 50 || aVal.length > 50) {
          changes.push(`${path}: changed (${bVal.length} \u2192 ${aVal.length} chars)`);
        } else {
          changes.push(`${path}: "${bVal}" \u2192 "${aVal}"`);
        }
      } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        if (Array.isArray(bVal) && Array.isArray(aVal)) {
          changes.push(`${path}: array changed (${bVal.length} \u2192 ${aVal.length} items)`);
        } else if (typeof bVal !== typeof aVal) {
          changes.push(`${path}: type changed`);
        } else if (typeof bVal === "object" && bVal !== null) {
          changes.push(...diffObjects(bVal, aVal, path));
        } else {
          changes.push(`${path}: ${JSON.stringify(bVal)} \u2192 ${JSON.stringify(aVal)}`);
        }
      }
    }
    return changes;
  }
  var logTransformsSkill = {
    name: "log-transforms",
    stage: "log",
    failMode: "graceful",
    run(ctx) {
      if (!isLoggingEnabled()) return ctx;
      if (ctx.snapshot && ctx.json) {
        const diffs = diffObjects(ctx.snapshot, ctx.json);
        if (diffs.length > 0) {
          ctx.logs.push(`[log-transforms] ${diffs.length} field(s) modified:`);
          diffs.forEach((d) => ctx.logs.push(`  \u2022 ${d}`));
        } else {
          ctx.logs.push("[log-transforms] No transformations applied");
        }
      }
      if (ctx.logs.length > 0) {
        const logger = typeof console !== "undefined" ? console : null;
        if (logger) {
          logger.debug(`[skills-pipeline] ${ctx.type} processed:`, ...ctx.logs);
          if (ctx.errors.length > 0) {
            logger.warn(`[skills-pipeline] ${ctx.errors.length} non-fatal error(s):`, ctx.errors);
          }
        }
      }
      return ctx;
    }
  };

  // src/shared/skills/index.mjs
  clearSkills();
  registerSkill(parseJsonSkill);
  registerSkill(validateSchemaSkill);
  registerSkill(detectOptionsSkill);
  registerSkill(formatTextFieldsSkill);
  registerSkill(trimDescriptionSkill);
  registerSkill(logTransformsSkill);
  async function processAIOutput(rawJsonString, type) {
    const ctx = createContext(rawJsonString, type);
    const result = await runPipeline(ctx);
    return {
      json: result.json,
      logs: result.logs,
      errors: result.errors,
      failed: result.failed,
      failReason: result.failReason
    };
  }
  return __toCommonJS(index_exports);
})();
