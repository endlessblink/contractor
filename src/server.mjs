// Load .env file if present
import { readFileSync as _readFileSync } from 'fs';
import { join as _join, dirname as _dirname } from 'path';
import { fileURLToPath as _fileURLToPath } from 'url';
try {
  const _envPath = _join(_dirname(_fileURLToPath(import.meta.url)), '..', '.env');
  const _envContent = _readFileSync(_envPath, 'utf-8');
  for (const line of _envContent.split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match && match[2]) process.env[match[1]] = process.env[match[1]] || match[2];
  }
} catch { /* no .env file */ }

// Keep process alive — catch unhandled errors instead of crashing
process.on('uncaughtException', (err) => { console.error('Uncaught error:', err.message); });
process.on('unhandledRejection', (err) => { console.error('Unhandled rejection:', err); });

import express from 'express';
import serveStatic from 'serve-static';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'fs';
import { homedir } from 'os';
import multer from 'multer';
import { generateDocument } from './generate-quote.mjs';
import mammoth from 'mammoth';
import { exec, execSync } from 'child_process';
import { createRequire } from 'module';
import { chatCompletion, chatCompletionStream, parseSSEStream, getProviderConfig } from './ai-provider.mjs';
import { IS_PKG, USER_DATA_DIR, APP_DIR, SNAPSHOT_DIR, initUserDataDir, resolveData, resolveAsset } from './app-paths.mjs';
import { CURRENT_VERSION, checkForUpdate, checkUpdateAvailable, downloadAndInstall } from './updater.mjs';

const require = createRequire(import.meta.url);
let pdfParser = null;
function getPdfParser() {
  if (!pdfParser) {
    try {
      const mod = require('pdf-parse');
      if (typeof mod === 'function') { pdfParser = { parse: mod }; }
      else if (mod.PDFParse) { pdfParser = new mod.PDFParse(); }
      else if (mod.default) { pdfParser = { parse: mod.default }; }
      else { pdfParser = { parse: async () => ({ text: '' }) }; }
    } catch { pdfParser = { parse: async () => ({ text: '' }) }; }
  }
  return pdfParser;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_DIR = join(__dirname, '..');
if (IS_PKG) initUserDataDir();
// CONTRACTOR_DATA_DIR env var overrides the data directory (for testing in dev mode too)
const DATA_DIR = process.env.CONTRACTOR_DATA_DIR || (IS_PKG ? USER_DATA_DIR : join(PROJECT_DIR, 'data'));
const OUTPUT_DIR = IS_PKG ? resolveData('output') : (process.env.CONTRACTOR_DATA_DIR ? join(DATA_DIR, 'output') : join(PROJECT_DIR, 'output'));
const UPLOADS_DIR = IS_PKG ? resolveData('uploads') : (process.env.CONTRACTOR_DATA_DIR ? join(DATA_DIR, 'uploads') : join(PROJECT_DIR, 'uploads'));

// Ensure data directories exist before fallback resolution
mkdirSync(join(DATA_DIR, 'knowledge', 'pending-extractions'), { recursive: true });
mkdirSync(join(DATA_DIR, 'references'), { recursive: true });
mkdirSync(join(DATA_DIR, 'projects'), { recursive: true });
// New data-based paths with fallback to old locations (dev mode only)
// When running as pkg, always use DATA_DIR paths — snapshot is read-only
const REFERENCES_DIR = IS_PKG
  ? join(DATA_DIR, 'references')
  : (readdirSync(join(DATA_DIR, 'references')).length > 0
    ? join(DATA_DIR, 'references') : join(PROJECT_DIR, 'document refrences - quotes'));
const PROJECTS_DIR = IS_PKG
  ? join(DATA_DIR, 'projects')
  : (readdirSync(join(DATA_DIR, 'projects')).length > 0
    ? join(DATA_DIR, 'projects') : join(PROJECT_DIR, 'projects'));
const KNOWLEDGE_DIR = IS_PKG
  ? join(DATA_DIR, 'knowledge')
  : (existsSync(join(DATA_DIR, 'knowledge', 'clauses-db.json'))
    ? join(DATA_DIR, 'knowledge') : join(PROJECT_DIR, 'knowledge'));
const USER_PROFILE_PATH = join(DATA_DIR, 'user-profile.json');

// Ensure remaining directories exist (never mkdir inside the snapshot)
mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(UPLOADS_DIR, { recursive: true });
if (!PROJECTS_DIR.startsWith('/snapshot/')) mkdirSync(PROJECTS_DIR, { recursive: true });
if (!KNOWLEDGE_DIR.startsWith('/snapshot/')) mkdirSync(KNOWLEDGE_DIR, { recursive: true });

// ─── Auto-initialize clause database from sample if missing ──────────────────
const clausesDbPath = join(KNOWLEDGE_DIR, 'clauses-db.json');
const clausesSamplePath = join(SNAPSHOT_DIR, 'knowledge', 'clauses-db.sample.json');
if (!existsSync(clausesDbPath)) {
  if (existsSync(clausesSamplePath)) {
    copyFileSync(clausesSamplePath, clausesDbPath);
    console.log('No clause database found — initialized from sample. Scan your own contracts to build your knowledge base.');
  } else {
    writeFileSync(clausesDbPath, JSON.stringify({ clauses: {}, serviceTemplates: [], paymentPatterns: [], standardTerms: {} }, null, 2), 'utf-8');
  }
}

// ─── Load clause database on startup ─────────────────────────────────────────
let clausesDb = null;
try {
  const dbRaw = readFileSync(clausesDbPath, 'utf-8');
  clausesDb = JSON.parse(dbRaw);
  // Handle old schema: rename 'categories' to 'clauses' if needed
  if (clausesDb.categories && !clausesDb.clauses) {
    clausesDb.clauses = clausesDb.categories;
    delete clausesDb.categories;
    writeFileSync(clausesDbPath, JSON.stringify(clausesDb, null, 2), 'utf-8');
    console.log('Migrated clauses DB: renamed "categories" → "clauses"');
  }
  const categoryCount = clausesDb.clauses ? Object.keys(clausesDb.clauses).length : 0;
  const clauseCount = clausesDb.clauses ? Object.values(clausesDb.clauses).reduce((sum, cat) => sum + (cat.clauses || []).length, 0) : 0;
  console.log(`Loaded clauses DB: ${clauseCount} clauses in ${categoryCount} categories`);
} catch { /* no clauses DB yet */ }

// ─── Robust JSON extractor ───────────────────────────────────────────────────
function extractJSON(rawText) {
  if (!rawText) {
    console.error('[extractJSON] rawText is empty/null');
    return null;
  }
  const text = rawText.trim();
  console.log(`[extractJSON] input length: ${text.length}, first 200 chars: ${text.slice(0, 200)}`);
  // 1. Already clean JSON
  try { return JSON.parse(text); } catch (e) { console.log('[extractJSON] strategy 1 (direct) failed:', e.message); }
  // 2. Strip markdown code fences
  const stripped = text.replace(/^[\s\S]*?```(?:json)?\s*\n?/i, '').replace(/\n?\s*```[\s\S]*$/, '').trim();
  if (stripped && stripped !== text) {
    try { return JSON.parse(stripped); } catch (e) { console.log('[extractJSON] strategy 2 (fences) failed:', e.message); }
  }
  // 3. Extract first { ... } or [ ... ] substring
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    const candidate = text.slice(objStart, objEnd + 1);
    try { return JSON.parse(candidate); } catch (e) { console.log('[extractJSON] strategy 3 (braces) failed:', e.message); }
    // 3b. Repair common JSON issues: trailing commas, missing brackets
    try {
      const repaired = candidate
        .replace(/,\s*([\]}])/g, '$1')           // trailing commas
        .replace(/(["\d\]}])\s*\n\s*"/g, '$1,"') // missing commas between properties
        .replace(/\n/g, ' ');
      return JSON.parse(repaired);
    } catch (e) { console.log('[extractJSON] strategy 3b (repair) failed:', e.message); }
  }
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(text.slice(arrStart, arrEnd + 1)); } catch (e) { console.log('[extractJSON] strategy 4 (brackets) failed:', e.message); }
  }
  console.error('[extractJSON] ALL strategies failed. Full text:', text.slice(0, 1000));
  return null;
}

// ─── Load user profile ──────────────────────────────────────────────────────
function loadUserProfile() {
  const defaults = {
    name: '', nameEn: '', company: '', companyHe: '',
    title: '', titleEn: '', email: '', website: '', phone: '',
    logoPath: '', language: 'he', currency: '₪', setupComplete: false,
    aiProvider: 'anthropic', aiModel: 'claude-sonnet-4-6',
    aiApiKey: '', useClaudeOAuth: false,
  };
  try {
    const raw = readFileSync(USER_PROFILE_PATH, 'utf-8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    // First run — create from example or defaults
    try {
      const examplePath = join(DATA_DIR, 'user-profile.example.json');
      if (existsSync(examplePath)) {
        const exampleRaw = readFileSync(examplePath, 'utf-8');
        writeFileSync(USER_PROFILE_PATH, exampleRaw, 'utf-8');
        return { ...defaults, ...JSON.parse(exampleRaw) };
      }
    } catch { /* ignore */ }
    writeFileSync(USER_PROFILE_PATH, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }
}

let userProfile = loadUserProfile();
console.log('Profile loaded from: ' + USER_PROFILE_PATH);
console.log('Profile loaded: setupComplete=' + userProfile.setupComplete + ', name=' + (userProfile.name || '(empty)') + ', apiKey=' + (userProfile.aiApiKey ? '***set***' : '(empty)'));

// ─── Project helper functions ─────────────────────────────────────────────────

function slugify(name) {
  const slug = (name || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u0590-\u05ff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `project-${Date.now()}`;
}

function readIndex() {
  try {
    const raw = readFileSync(join(PROJECTS_DIR, '_index.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { projects: [], activeProjectId: null };
  }
}

function writeIndex(data) {
  writeFileSync(join(PROJECTS_DIR, '_index.json'), JSON.stringify(data, null, 2), 'utf-8');
}

function readProject(id) {
  const projectPath = join(PROJECTS_DIR, id, 'project.json');
  let project;
  try {
    const raw = readFileSync(projectPath, 'utf-8');
    project = JSON.parse(raw);
  } catch {
    return { name: '', id, createdAt: null, chatHistory: [], formStates: {}, activeDocType: 'quote' };
  }
  // Lazy migration: formState (old) → formStates (new)
  if (project.formState && !project.formStates) {
    const docType = project.formState.docType || 'quote';
    project.formStates = { [docType]: project.formState };
    project.activeDocType = docType;
    delete project.formState;
    // Write back to migrate on disk
    writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf-8');
  }
  // Ensure formStates always exists
  if (!project.formStates) {
    project.formStates = {};
    project.activeDocType = 'quote';
  }
  return project;
}

function writeProject(id, data) {
  const dir = join(PROJECTS_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), JSON.stringify(data, null, 2), 'utf-8');
}

function getProjectPath(id, subfolder) {
  // Validate against path traversal
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    return null;
  }
  if (subfolder && (subfolder.includes('..') || subfolder.includes('/') || subfolder.includes('\\'))) {
    return null;
  }
  const p = subfolder ? join(PROJECTS_DIR, id, subfolder) : join(PROJECTS_DIR, id);
  mkdirSync(p, { recursive: true });
  return p;
}

function loadLearnedContext() {
  try {
    const raw = readFileSync(join(KNOWLEDGE_DIR, 'learned-context.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Load learned context on startup
let learnedContext = null;
try {
  const ctx = readFileSync(join(KNOWLEDGE_DIR, 'learned-context.json'), 'utf-8');
  learnedContext = JSON.parse(ctx);
  console.log(`Loaded learned context: ${learnedContext.documentsAnalyzed} documents analyzed`);
} catch { /* no learned context yet */ }

// ─── Load clients database on startup ─────────────────────────────────────────
const CLIENTS_PATH = join(DATA_DIR, 'clients.json');
let clientsDb = { clients: [] };
try {
  const raw = readFileSync(CLIENTS_PATH, 'utf-8');
  clientsDb = JSON.parse(raw);
  console.log(`Loaded clients DB: ${clientsDb.clients.length} clients`);
} catch {
  // First run — create empty clients file
  writeFileSync(CLIENTS_PATH, JSON.stringify({ clients: [] }, null, 2), 'utf-8');
}

// ─── Client helper functions ──────────────────────────────────────────────────

function loadClients() {
  try {
    const raw = readFileSync(CLIENTS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { clients: [] };
  }
}

function saveClients(clientsData) {
  writeFileSync(CLIENTS_PATH, JSON.stringify(clientsData, null, 2), 'utf-8');
  clientsDb = clientsData;
}

function generateClientId(name) {
  const slug = (name || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u0590-\u05ff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `client-${Date.now()}`;
}

function fuzzyMatchClient(name, clients) {
  if (!name || !clients || clients.length === 0) return [];
  const normalized = name.trim().toLowerCase();

  const matches = clients
    .map(client => {
      const clientName = (client.name || '').trim().toLowerCase();
      // Exact match
      if (clientName === normalized) {
        return { ...client, score: 100 };
      }
      // Contains match (either direction)
      if (clientName.includes(normalized) || normalized.includes(clientName)) {
        return { ...client, score: 80 };
      }
      // Simple character overlap
      const nameChars = new Set(normalized.replace(/[\s-]/g, '').split(''));
      const clientChars = new Set(clientName.replace(/[\s-]/g, '').split(''));
      const allChars = new Set([...nameChars, ...clientChars]);
      const commonChars = [...nameChars].filter(c => clientChars.has(c)).length;
      const overlap = allChars.size > 0 ? commonChars / allChars.size : 0;
      if (overlap > 0.7) {
        return { ...client, score: 60 };
      }
      return null;
    })
    .filter(m => m !== null && m.score >= 50)
    .sort((a, b) => b.score - a.score);

  return matches;
}

const app = express();
const PORT = process.env.PORT || 6831;

// Load full business context from skills files
function loadContextFile(filepath) {
  try { return readFileSync(join(PROJECT_DIR, filepath), 'utf-8'); } catch { return ''; }
}

const freelanceSkill = loadContextFile('skills/freelance-doc-maker.md');
const rtlSkill = loadContextFile('skills/rtl-hebrew-docx.md');

// List reference documents for context
function getRefDocList() {
  try {
    const docs = [];
    for (const sub of ['2025', 'Jan-Feb 2026']) {
      const subPath = join(REFERENCES_DIR, sub);
      try {
        const files = readdirSync(subPath).filter(f => f.endsWith('.docx') || f.endsWith('.pdf'));
        docs.push(...files.map(f => `${sub}/${f}`));
      } catch { /* skip */ }
    }
    return docs.join('\n');
  } catch { return ''; }
}

function buildClausesPromptSection() {
  if (!clausesDb?.clauses) return '';

  try {
  let section = '\n\n## מאגר סעיפים משפטיים מלא\n';
  section += 'להלן כל הסעיפים המשפטיים הזמינים, מאורגנים לפי קטגוריה. השתמש בסעיפים אלו בעת יצירת מסמכים — בחר את הסעיפים הרלוונטיים לפי סוג המסמך וסוג הפרויקט.\n';

  // Add clause categories with IDs and short preview (full text used at generation time)
  for (const [key, category] of Object.entries(clausesDb.clauses)) {
    const clauses = Array.isArray(category?.clauses) ? category.clauses : [];
    section += `\n### ${category?.category || key} (${clauses.length} סעיפים)\n`;
    for (const clause of clauses) {
      const docTypes = Array.isArray(clause?.appliesTo) ? clause.appliesTo.join('/') : 'all';
      section += `- [${clause?.id || '?'}] (${docTypes}${clause?.required ? ' | חובה' : ''}): ${(clause?.text || '').slice(0, 80)}...\n`;
    }
  }

  // Add payment patterns
  const patterns = Array.isArray(clausesDb.paymentPatterns) ? clausesDb.paymentPatterns : [];
  if (patterns.length > 0) {
    section += '\n### מבנה תשלומים\n';
    for (const pattern of patterns) {
      section += `- **${pattern?.name || ''}**: ${pattern?.description || ''} (${pattern?.usage || ''})\n`;
    }
  }

  // Add service templates
  const templates = Array.isArray(clausesDb.serviceTemplates) ? clausesDb.serviceTemplates : [];
  if (templates.length > 0) {
    section += '\n### תבניות שירות לפי סוג פרויקט\n';
    section += 'כאשר יוצרים מסמך, בחר את הסעיפים הרלוונטיים לפי סוג הפרויקט:\n';
    for (const template of templates) {
      section += `\n**${template?.name || ''}** (${template?.type || ''}):\n`;
      section += `- תמחור טיפוסי: ${JSON.stringify(template?.typicalPricing || {})}\n`;
      section += `- לוח זמנים: ${template?.typicalTimeline || ''}\n`;
      section += `- תוצרים: ${template?.typicalDeliverables || ''}\n`;
      section += `- סעיפים רלוונטיים: ${Array.isArray(template?.relevantClauses) ? template.relevantClauses.join(', ') : ''}\n`;
    }
  }

  // Add standard terms
  const terms = clausesDb.standardTerms || {};
  if (Object.keys(terms).length > 0) {
    section += '\n### תנאים סטנדרטיים\n';
  if (terms.quoteValidity) section += `- תוקף הצעה: ${terms.quoteValidity}\n`;
  if (terms.vatNote) section += `- מע"מ: ${terms.vatNote}\n`;
  if (terms.hourlyRates) section += `- תעריפים שעתיים: רגיל ${terms.hourlyRates.standard || '?'} ₪, פיתוח ${terms.hourlyRates.development || '?'} ₪, בכיר ${terms.hourlyRates.senior || '?'} ₪\n`;
  if (terms.revisionRounds) section += `- סבבי תיקונים: ${terms.revisionRounds}\n`;
  if (terms.feedbackWindow) section += `- חלון משוב: ${terms.feedbackWindow}\n`;
  if (terms.warrantyPeriod) section += `- תקופת אחריות: ${terms.warrantyPeriod}\n`;
  if (terms.cancellationNotice) section += `- הודעת ביטול: ${terms.cancellationNotice}\n`;
  if (terms.suspensionThreshold) section += `- סף השהיית פרויקט: ${terms.suspensionThreshold}\n`;
  }

  section += '\n### הנחיות לשימוש בסעיפים\n';
  section += '1. **הצעת מחיר**: כלול רק סעיפים עם appliesTo שכולל "quote". בדרך כלל: תנאי תשלום, סעיף ביטול, תוקף הצעה, והערת AI אם רלוונטי.\n';
  section += '2. **חוזה/הזמנת עבודה**: כלול את כל הסעיפים הרלוונטיים — תנאי תשלום, התחייבויות לקוח, ביטול, תיקונים, IP, אחריות, תנאים כלליים.\n';
  section += '3. **בחירה לפי סוג פרויקט**: השתמש ברשימת הסעיפים הרלוונטיים (relevantClauses) מתבנית השירות המתאימה.\n';
  section += '4. **סעיפי חובה**: סעיפים המסומנים "חובה" חייבים להיכלל תמיד בסוג המסמך הרלוונטי.\n';
  section += '5. **הוספת סעיפים חדשים**: אם יש צורך בסעיף שלא קיים במאגר, צור אותו והציע להוסיף אותו למאגר.\n';

  section += '\n### שמירת סעיפים חדשים למאגר\n';
  section += 'כשאתה מזהה סעיף חדש שצריך להישמר למאגר (מתוך הערות המשתמש, שיחה, או תוכן שנוצר), הוסף בסוף התשובה בלוק מוסתר:\n';
  section += '<!--SAVE_CLAUSE:{"category":"generalTerms","id":"unique-slug","text":"טקסט הסעיף בעברית","appliesTo":["contract","workOrder"],"required":false}-->\n';
  section += 'האפליקציה תזהה את הבלוק ותציע למשתמש לשמור את הסעיף.\n';

  return section;
  } catch (err) {
    console.error('buildClausesPromptSection error:', err.message);
    return '';
  }
}

function getSystemPrompt() {
  const p = userProfile;
  const nameDisplay = p.nameEn ? `${p.name} (${p.nameEn})` : p.name || 'המשתמש';
  const langNote = p.language === 'he' ? 'תמיד ענה בעברית אלא אם התבקשת אחרת.' : 'Respond in English unless asked otherwise.';

  let prompt = `אתה העוזר האישי של ${p.name || 'המשתמש'} ליצירת מסמכים עסקיים.
${langNote}

## הזהות שלך
- שם: ${nameDisplay}
- חברה: ${p.company || ''}
- תפקיד: ${p.title || ''}
- אימייל: ${p.email || ''} | אתר: ${p.website || ''} | טלפון: ${p.phone || ''}

## סוגי מסמכים
1. הצעת מחיר — הצעה ראשונית ללקוח
2. הזמנת עבודה — הסכם פורמלי אחרי אישור הצעה
3. חוזה — הסכם מפורט עם תנאים מלאים

## מסמכי עזר זמינים במערכת
המשתמש יכול לנתח מסמכים קיימים דרך לשונית "מסמכים" באפליקציה.

## תפקידך
אתה **עוזר** שמסייע למשתמש ליצור מסמכים. אתה לא כותב את המסמך בצ'אט — המערכת מייצרת מסמכי DOCX מקצועיים.
**לעולם אל תכתוב הצעת מחיר, חוזה או הזמנת עבודה בתוך הצ'אט.** המסמכים נוצרים דרך הטופס בלשונית "יצירת מסמך".

## האפליקציה
המשתמש עובד עם אפליקציית יצירת מסמכים שכוללת:
- לשונית צ'אט (כאן) — לשאלות, עזרה, ייעוץ, והכנת מסמכים
- לשונית יצירת מסמך — טופס למילוי פרטים ויצירת DOCX
- לשונית מסמכים — צפייה במסמכים שנוצרו, העלאת קבצים, ניתוח מסמכים קיימים

## כשהמשתמש מבקש ליצור מסמך (הצעת מחיר / חוזה / הזמנת עבודה)

### שלב 1: שאל שאלות קריטיות
אם חסר מידע קריטי, שאל **רק** את מה שחסר מתוך:
- שם הלקוח / חברה (חובה)
- פריטי תמחור — מה השירות ומה המחיר (חובה)
- לוח זמנים (אם לא צוין)

**אל תשאל על:** תנאי תשלום (ברירת מחדל: 35%/65%), תוקף הצעה (ברירת מחדל: 30 יום), סעיפי חוזה (ייבחרו אוטומטית).

### שלב 2: סכם בקצרה
הצג סיכום קצר (3-5 שורות) של מה שיכלל במסמך — זה לא המסמך עצמו, רק אישור שהבנת נכון.

### שלב 3: מלא את הטופס
הוסף בסוף התשובה בלוק FORM_DATA מוסתר כדי למלא את הטופס אוטומטית, ואמור למשתמש לעבור ללשונית "יצירת מסמך" וללחוץ "צור מסמך".

## פורמט FORM_DATA
כשיש מידע מספיק, הוסף בסוף התשובה (בשורה חדשה):
<!--FORM_DATA:{"clientName":"...","clientCompany":"...","docType":"quote","projectDescription":"...","serviceDetails":"...","pricingItems":[{"desc":"...","qty":1,"price":0}],"paymentStructure":"two","customInstallments":[50,50,0],"timeline":"...","notes":"..."}-->

כללים:
- docType: "quote" | "order" | "contract"
- paymentStructure: "two" (35/65) | "three" (40/30/30) | "custom"
- customInstallments: מערך של 3 אחוזים (רק כש-paymentStructure הוא "custom")
- מחירים: מספרים בלבד (ללא ₪ או פסיקים)
- שדה ריק = מחרוזת ריקה
- הוסף FORM_DATA רק כשיש מידע מספיק
- projectDescription: כותרת קצרה בלבד (עד 10 מילים)
- שדות טקסט (notes, serviceDetails, timeline): הפרד פריטים ב-\\n
- JSON לא תקין יידחה אוטומטית

## פורמט FORM_UPDATE (תיקונים נקודתיים)
כשאתה בודק טופס קיים ומזהה בעיות, השתמש ב-FORM_UPDATE (לא FORM_DATA).
FORM_DATA מחליף את כל הטופס. FORM_UPDATE מתקן רק את מה שצריך.

הוסף בסוף התשובה:
<!--FORM_UPDATE:{"actions":[...]}-->

סוגי פעולות:
- {"type":"addClause","clauseId":"..."}  — בחר סעיף חסר
- {"type":"removeClause","clauseId":"..."}  — בטל בחירת סעיף לא רלוונטי
- {"type":"editClause","clauseId":"...","text":"טקסט מתוקן"}  — ערוך טקסט סעיף
- {"type":"updateField","field":"notes|timeline|serviceDetails|projectDescription","value":"..."}  — עדכן שדה (שלח ערך מלא חדש)
- {"type":"addPricingRow","desc":"...","qty":1,"price":0,"option":""}  — הוסף שורת תמחור
- {"type":"removePricingRow","index":0}  — הסר שורת תמחור (0 = ראשונה)
- {"type":"updatePricingRow","index":0,"desc":"...","price":100}  — עדכן שורה קיימת
- {"type":"setPayment","structure":"two|three|custom","installments":[40,30,30]}
- {"type":"toggleSection","section":"timeline|notes","enabled":true}

## אופציות תמחור
כשיש שתי אופציות או יותר בטופס (למשל "אופציה 1" ו"אופציה 2"), כל שורת תמחור צריכה שדה option עם מספר האופציה ("1", "2" וכו').
כשהשדה option מוגדר, המערכת מציגה סה"כ נפרד לכל אופציה (לא חיבור של כולן).
אם שורות תמחור חסרות option — השתמש ב-updatePricingRow כדי להוסיף אותו:
{"type":"updatePricingRow","index":0,"option":"1"}

כללים:
- השתמש ב-FORM_UPDATE בתשובה לבדיקת טופס או תיקון בעיות ספציפיות
- אל תשלב FORM_DATA ו-FORM_UPDATE באותה תשובה
- כשבודק טופס, תמיד כלול FORM_UPDATE עם כל התיקונים — אל תבקש מהמשתמש לתקן ידנית
- בעדכון שדות טקסט, שלח את הערך המלא החדש
- כשיש בעיה — תקן אותה ב-FORM_UPDATE. אל תציע "מומלץ לתקן" בלי לכלול את התיקון בפועל
- **חשוב:** כשמעדכנים תוכן של אופציה, תמיד עדכן גם את serviceDetails וגם את שורת התמחור המתאימה (updatePricingRow). שניהם מופיעים במסמך — אם תעדכן רק אחד, המסמך יהיה לא עקבי.

## ניתוח תמונות וצילומי מסך

כשמשתמש שולח צילום מסך של שיחה, הודעה, אימייל, או מסמך — נתח את התוכן וחלץ את המידע הרלוונטי:
- שם לקוח וחברה
- תיאור פרויקט ופרטי שירות
- פריטי תמחור (תיאור, כמות, מחיר)
- תנאי תשלום
- לוחות זמנים
- הערות נוספות

לאחר הניתוח, מלא את הטופס באמצעות FORM_DATA.

## חשוב
- **לעולם אל תדבר בגוף ראשון רבים ("אנחנו מציעים", "אנו שמחים").** אתה עוזר — לא כותב המסמך.
- **לעולם אל תכתוב מסמך מלא בצ'אט.** הטופס + המערכת יוצרים את ה-DOCX.
- **אל תוסיף משפטי שיווק/נימוסין** כמו "אשמח להתאים", "נשמח לעמוד לרשותכם", "בואו נדבר". הערות צריכות להיות עובדתיות בלבד (תוקף, מע"מ, תנאים טכניים).
- כשאתה בודק טופס (בעקבות "בדוק טופס"), דווח על בעיות **וגם** כלול בלוק FORM_UPDATE עם כל התיקונים. המשתמש יוכל ללחוץ "החל תיקונים" ישירות מהצ'אט.
- **עברית תקינה בלבד.** בדוק כל טקסט בעברית לפני שליחה — ללא שגיאות כתיב, דקדוק, או ניסוח לא טבעי. פנה ללקוח בלשון זכר (ללקוח, עבורך) אלא אם צוין אחרת.
- **כשמזכיר סעיפים בצ'אט, תמיד כתוב בעברית** — לא IDs באנגלית. למשל: "סעיף מקדמה 45%" ולא "payment-advance-45percent". ה-IDs הם פנימיים — המשתמש לא צריך לראות אותם. השתמש ב-IDs רק בבלוקים טכניים (FORM_UPDATE, FORM_DATA).
- כשהמשתמש שואל על תמחור, תנאים, או מבנה — השתמש בידע מהסעיפים למטה.

## יצירת חוזה מהצעת מחיר
כשהמשתמש מבקש ליצור חוזה או הזמנת עבודה — **אל תשאל שאלות, פשוט צור אותו מיד.**
1. השתמש בנתוני הטופס הנוכחי (שם לקוח, תמחור, פרטי שירות)
2. **חובה:** צור FORM_DATA (לא FORM_UPDATE!) עם docType:"contract" (או "order") — זה יחליף את סוג המסמך בטופס
3. כלול את כל השדות: clientName, clientCompany, projectDescription, serviceDetails, pricingItems, notes, timeline
4. הוסף סעיפים ספציפיים לחוזה (התחייבויות לקוח, קניין רוחני, ביטול עבודה מוקדמת)
5. הצעת המחיר המקורית תישמר אוטומטית — אין צורך ליצור פרויקט חדש
6. **אל תשתמש ב-FORM_UPDATE לשינוי סוג מסמך** — רק FORM_DATA מחליף את הטופס כולו`;

  prompt += buildClausesPromptSection();

  if (learnedContext) {
    prompt += `\n\n## ידע נלמד\nנלמדו ${learnedContext.documentsAnalyzed || 0} מסמכי עזר. הסעיפים, תבניות השירות ומבנה התשלומים זמינים למעלה.`;
  }

  return prompt;
}


// ─── Shared extraction prompt builder ─────────────────────────────────────────

function buildExtractionPrompt(existingClauseIds) {
  return `אתה מנתח מסמכים עסקיים ומומחה בחילוץ סעיפים משפטיים. קיבלת תוכן של מספר הצעות מחיר וחוזים.

נתח את כל המסמכים והחזר JSON בפורמט הבא בדיוק:

{
  "newClauses": [
    {
      "category": "paymentTerms|clientObligations|earlyTermination|deliveryProcess|intellectualProperty|aiDisclaimers|warrantyAndCompletion|revisions|generalTerms",
      "id": "unique-slug-id",
      "text": "הטקסט המלא של הסעיף בעברית",
      "appliesTo": ["quote", "contract", "workOrder"],
      "required": true/false,
      "notes": "הערה קצרה באנגלית (אופציונלי)"
    }
  ],
  "newServiceTemplates": [
    {
      "type": "slug-name",
      "name": "שם בעברית",
      "typicalPricing": [{"desc": "תיאור", "qty": 1, "price": 0}],
      "typicalTimeline": "...",
      "typicalDeliverables": "...",
      "relevantClauses": ["clause-id-1", "clause-id-2"],
      "exampleClients": ["שם לקוח"]
    }
  ],
  "newPaymentPatterns": [
    {
      "id": "slug-id",
      "name": "שם בעברית",
      "description": "תיאור",
      "installments": [35, 65],
      "usage": "מתי להשתמש"
    }
  ],
  "updatedStandardTerms": {
    "quoteValidity": "30 יום",
    "vatNote": "...",
    "hourlyRates": { "standard": 0, "development": 0, "senior": 0 },
    "revisionRounds": 2,
    "feedbackWindow": "2 ימי עבודה",
    "warrantyPeriod": "5 ימי עבודה",
    "cancellationNotice": "7 ימים בכתב",
    "suspensionThreshold": "5 ימי עבודה עיכוב"
  },
  "providerProfile": {
    "name": "שם מלא של הספק/נותן השירות בעברית",
    "nameEn": "Full name in English (if found)",
    "company": "שם העסק/חברה באנגלית",
    "companyHe": "שם העסק/חברה בעברית",
    "title": "תפקיד בעברית",
    "titleEn": "Title in English",
    "email": "כתובת אימייל",
    "website": "אתר אינטרנט",
    "phone": "טלפון"
  }
}

סעיפים קיימים כבר במאגר (אל תכלול אותם ב-newClauses אלא אם הטקסט שלהם שונה):
${existingClauseIds.join(', ')}

קטגוריות:
- paymentTerms: תמורה ותנאי תשלום
- clientObligations: התחייבויות הלקוח
- earlyTermination: הפסקת עבודה מוקדמת
- deliveryProcess: תהליך סיום ומסירה
- intellectualProperty: קניין רוחני, רישוי ואחריות
- aiDisclaimers: הצהרות לקוח AI גנרטיבי
- warrantyAndCompletion: הגדרת סיום ותקופת אחריות
- revisions: תיקונים והערות
- generalTerms: תנאים כלליים

חשוב:
1. חלץ את הטקסט המלא של כל סעיף — לא תקציר
2. זהה סעיפים חדשים שלא ברשימה הקיימת
3. אם סעיף קיים אבל בגרסה מפורטת יותר, כלול אותו עם ה-id הקיים
4. appliesTo: "quote" = הצעת מחיר, "contract" = חוזה, "workOrder" = הזמנת עבודה
5. required = true לסעיפים שמופיעים בכל המסמכים מסוג זה
6. providerProfile: חלץ את פרטי הספק/נותן השירות (לא הלקוח!) מהמסמכים — שם, חברה, טלפון, אימייל, אתר. זה בדרך כלל מופיע בכותרת או בתחתית המסמך.`;
}

// ─── Multer config ────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    cb(null, `${ts}_${file.originalname}`);
  },
});

const upload = multer({ storage });

// Dynamic multer for project-aware uploads
const dynamicUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const projectId = req.query.projectId || req.body?.projectId;
      let dest = UPLOADS_DIR;
      if (projectId) {
        const projPath = getProjectPath(projectId, 'uploads');
        if (projPath) dest = projPath;
      }
      mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}_${file.originalname}`);
    },
  }),
});

// ─── Middleware ───────────────────────────────────────────────────────────────

app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
// Log all POST requests for debugging
app.use((req, _res, next) => {
  if (req.method === 'POST') console.log(`[REQ] ${req.method} ${req.url} (${req.headers['content-type'] || 'no content-type'})`);
  next();
});
app.use(serveStatic(join(__dirname, '..', 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html') || path.endsWith('/')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Force fresh HTML on every load (prevent browser caching old version)
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

// ─── User Profile API ────────────────────────────────────────────────────────

app.get('/api/user-profile', (_req, res) => {
  res.json(userProfile);
});

app.put('/api/user-profile', (req, res) => {
  try {
    userProfile = { ...userProfile, ...req.body };
    writeFileSync(USER_PROFILE_PATH, JSON.stringify(userProfile, null, 2), 'utf-8');
    res.json({ success: true, profile: userProfile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user-profile/logo', upload.single('logo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const logoFilename = 'logo' + extname(req.file.originalname);
    const logoPath = join(DATA_DIR, logoFilename);
    const fileData = readFileSync(req.file.path);
    writeFileSync(logoPath, fileData);
    rmSync(req.file.path);
    userProfile.logoPath = logoFilename;
    writeFileSync(USER_PROFILE_PATH, JSON.stringify(userProfile, null, 2), 'utf-8');
    res.json({ success: true, logoPath: logoFilename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/setup-status', (_req, res) => {
  res.json({
    setupComplete: userProfile.setupComplete,
    hasProfile: !!(userProfile.name || userProfile.nameEn),
    hasLogo: !!userProfile.logoPath,
    version: CURRENT_VERSION,
    update: global._updateAvailable || null,
  });
});

// Check for updates (returns info without downloading)
app.post('/api/check-update', async (_req, res) => {
  try {
    const info = await checkUpdateAvailable();
    if (!info) return res.json({ upToDate: true, version: CURRENT_VERSION });
    global._updateAvailable = info;
    res.json({ upToDate: false, ...info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download and install update (replaces exe, tells user to restart)
app.post('/api/install-update', async (_req, res) => {
  try {
    const info = global._updateAvailable || await checkUpdateAvailable();
    if (!info) return res.json({ upToDate: true, version: CURRENT_VERSION });
    if (!info.asset) return res.status(400).json({ error: 'No binary available for this platform', url: info.url });
    const result = await downloadAndInstall(info.asset);
    res.json({ status: 'installed', latest: info.latest, message: result.message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Reference document management endpoints ─────────────────────────────────

// Upload references to data/references/
app.post('/api/references/upload', (req, res, next) => { console.log('[upload-references] HIT endpoint'); next(); }, upload.array('files', 20), (req, res) => {
  try {
    const files = req.files || [];
    console.log('[upload-references] Files received:', files.length, 'multer temp dir:', UPLOADS_DIR);
    if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const results = [];
    const refsDir = join(DATA_DIR, 'references');

    console.log('[upload-references] Saving to:', refsDir);
    for (const file of files) {
      const destPath = join(refsDir, file.originalname);
      const fileData = readFileSync(file.path);
      writeFileSync(destPath, fileData);
      rmSync(file.path);
      results.push({ filename: file.originalname, size: file.size });
      console.log('[upload-references] Saved:', file.originalname, fileData.length, 'bytes');
    }

    res.json({ success: true, uploaded: results.length, files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List ALL reference documents recursively
app.get('/api/references', (_req, res) => {
  try {
    const results = [];

    function scanDir(dir, source, relPath) {
      let entries;
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries) {
        const fullPath = join(dir, name);
        try {
          const s = statSync(fullPath);
          if (s.isDirectory()) {
            scanDir(fullPath, source, relPath ? `${relPath}/${name}` : name);
            continue;
          }
          const ext = name.split('.').pop().toLowerCase();
          if (!['docx', 'doc', 'pdf'].includes(ext)) continue;
          results.push({
            name,
            folder: relPath || undefined,
            source,
            size: s.size,
            modified: s.mtime.toISOString(),
          });
        } catch { /* skip unreadable */ }
      }
    }

    scanDir(REFERENCES_DIR, 'uploaded', '');

    results.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ references: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete uploaded reference (only from data/references/)
app.delete('/api/references/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = join(DATA_DIR, 'references', filename);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    rmSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analyze references: extract clauses via Claude API and save as pending extraction
app.post('/api/references/analyze', async (req, res) => {
  try {
    const { filenames } = req.body || {};

    // Collect files to analyze
    const refsDir = join(DATA_DIR, 'references');
    const oldRefsDir = join(PROJECT_DIR, 'document refrences - quotes');
    let filesToAnalyze = [];

    if (filenames && filenames.length > 0) {
      for (const f of filenames) {
        if (f.includes('..')) continue;
        let fullPath = join(refsDir, f);
        if (!existsSync(fullPath)) {
          for (const sub of ['2025', 'Jan-Feb 2026']) {
            const candidate = join(oldRefsDir, sub, f);
            if (existsSync(candidate)) { fullPath = candidate; break; }
          }
        }
        if (existsSync(fullPath)) filesToAnalyze.push({ name: f, path: fullPath });
      }
    } else {
      try {
        for (const name of readdirSync(refsDir)) {
          const ext = name.split('.').pop().toLowerCase();
          if (['docx', 'pdf'].includes(ext)) {
            filesToAnalyze.push({ name, path: join(refsDir, name) });
          }
        }
      } catch { /* empty */ }
    }

    if (filesToAnalyze.length === 0) {
      return res.status(404).json({ error: 'No files found to analyze' });
    }

    // Extract text from each file
    const extractedDocs = [];
    for (const file of filesToAnalyze) {
      const ext = file.name.split('.').pop().toLowerCase();
      let text = '';
      try {
        if (ext === 'docx') {
          const result = await mammoth.extractRawText({ path: file.path });
          text = result.value;
        } else if (ext === 'pdf') {
          const buffer = readFileSync(file.path);
          const pdfData = await getPdfParser().parse(buffer);
          text = pdfData.text;
        }
      } catch (err) {
        console.error(`Error extracting text from ${file.name}:`, err.message);
        continue;
      }
      if (text && text.trim().length > 10) {
        extractedDocs.push({ name: file.name, text: text.slice(0, 15000) });
      }
    }

    if (extractedDocs.length === 0) {
      return res.status(400).json({ error: 'Could not extract text from any files' });
    }

    // Load existing clause IDs to avoid duplicates
    let existingClauseIds = [];
    try {
      const db = JSON.parse(readFileSync(join(KNOWLEDGE_DIR, 'clauses-db.json'), 'utf-8'));
      existingClauseIds = Object.values(db.clauses).flatMap(cat => cat.clauses.map(c => c.id));
    } catch { /* empty */ }

    const systemPrompt = buildExtractionPrompt(existingClauseIds);

    const combinedText = extractedDocs
      .map((doc, i) => `=== מסמך ${i + 1}: ${doc.name} ===\n${doc.text}`)
      .join('\n\n---\n\n');

    // Call AI API
    let apiData;
    try {
      apiData = await chatCompletion({
        system: systemPrompt,
        messages: [{ role: 'user', content: `נתח את ${extractedDocs.length} המסמכים הבאים והחזר JSON מלא:\n\n${combinedText.slice(0, 80000)}` }],
        maxTokens: 8192,
      });
    } catch (err) {
      console.error('AI API error (analyze):', err.message);
      return res.status(502).json({ error: err.message });
    }

    const rawText = apiData.text;
    const jsonText = rawText.replace(/^[\s\S]*?```(?:json)?\s*\n?/i, '').replace(/\n?\s*```[\s\S]*$/, '').trim() || rawText.trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response', rawText: rawText.slice(0, 500) });
    }

    // Save as pending extraction
    const extractionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const extraction = {
      id: extractionId,
      createdAt: new Date().toISOString(),
      status: 'pending',
      sourceFiles: filesToAnalyze.map(f => f.name),
      items: {
        newClauses: (parsed.newClauses || []).map(c => ({ ...c, status: 'pending' })),
        newServiceTemplates: (parsed.newServiceTemplates || []).map(t => ({ ...t, status: 'pending' })),
        newPaymentPatterns: (parsed.newPaymentPatterns || []).map(p => ({ ...p, status: 'pending' })),
        updatedStandardTerms: parsed.updatedStandardTerms || null,
      },
      summary: {
        clauseCount: (parsed.newClauses || []).length,
        templateCount: (parsed.newServiceTemplates || []).length,
        patternCount: (parsed.newPaymentPatterns || []).length,
      },
    };

    const pendingDir = join(DATA_DIR, 'knowledge', 'pending-extractions');
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(join(pendingDir, `${extractionId}.json`), JSON.stringify(extraction, null, 2), 'utf-8');

    res.json({ success: true, extraction });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Extraction review endpoints ──────────────────────────────────────────────

// List pending extractions
app.get('/api/extractions', (_req, res) => {
  try {
    const pendingDir = join(DATA_DIR, 'knowledge', 'pending-extractions');
    const results = [];
    try {
      for (const name of readdirSync(pendingDir)) {
        if (!name.endsWith('.json')) continue;
        const data = JSON.parse(readFileSync(join(pendingDir, name), 'utf-8'));
        results.push({
          id: data.id,
          createdAt: data.createdAt,
          status: data.status,
          sourceFiles: data.sourceFiles,
          summary: data.summary,
        });
      }
    } catch { /* empty */ }
    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ extractions: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get full extraction details
app.get('/api/extractions/:id', (req, res) => {
  try {
    const id = req.params.id;
    if (id.includes('..') || id.includes('/')) return res.status(400).json({ error: 'Invalid ID' });
    const filePath = join(DATA_DIR, 'knowledge', 'pending-extractions', `${id}.json`);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Extraction not found' });
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve selected items from an extraction and merge into clauses DB
app.post('/api/extractions/:id/approve', (req, res) => {
  try {
    const id = req.params.id;
    if (id.includes('..') || id.includes('/')) return res.status(400).json({ error: 'Invalid ID' });
    const filePath = join(DATA_DIR, 'knowledge', 'pending-extractions', `${id}.json`);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Extraction not found' });

    const extraction = JSON.parse(readFileSync(filePath, 'utf-8'));
    const { approvedIds, editedItems } = req.body || {};

    // Load current clauses DB
    const dbPath = join(KNOWLEDGE_DIR, 'clauses-db.json');
    let db;
    try {
      db = JSON.parse(readFileSync(dbPath, 'utf-8'));
    } catch {
      db = { version: 1, createdAt: new Date().toISOString(), clauses: {}, serviceTemplates: [], paymentPatterns: [], standardTerms: {} };
    }

    let added = 0;

    // Merge approved clauses
    for (const clause of (extraction.items.newClauses || [])) {
      if (clause.status !== 'pending') continue;
      if (approvedIds && !approvedIds.includes(clause.id)) continue;

      // Apply edits if provided
      if (editedItems && editedItems[clause.id]) {
        Object.assign(clause, editedItems[clause.id]);
      }

      // Ensure category exists in DB
      if (!db.clauses[clause.category]) {
        db.clauses[clause.category] = {
          name: clause.category,
          category: clause.category,
          clauses: [],
        };
      }

      // Check if clause already exists (update vs add)
      const existing = db.clauses[clause.category].clauses.findIndex(c => c.id === clause.id);
      const clauseData = { id: clause.id, name: clause.name || clause.id, text: clause.text, appliesTo: clause.appliesTo, required: clause.required || false };

      if (existing >= 0) {
        db.clauses[clause.category].clauses[existing] = clauseData;
      } else {
        db.clauses[clause.category].clauses.push(clauseData);
      }

      clause.status = 'approved';
      added++;
    }

    // Merge approved service templates
    for (const tmpl of (extraction.items.newServiceTemplates || [])) {
      if (tmpl.status !== 'pending') continue;
      if (approvedIds && !approvedIds.includes(tmpl.type)) continue;

      if (!db.serviceTemplates) db.serviceTemplates = [];
      const existing = db.serviceTemplates.findIndex(t => t.type === tmpl.type);
      const tmplData = { ...tmpl };
      delete tmplData.status;

      if (existing >= 0) {
        db.serviceTemplates[existing] = tmplData;
      } else {
        db.serviceTemplates.push(tmplData);
      }
      tmpl.status = 'approved';
      added++;
    }

    // Save updated DB
    db.updatedAt = new Date().toISOString();
    writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');

    // Reload in memory
    clausesDb = db;

    // Update extraction status
    const allApproved = [...(extraction.items.newClauses || []), ...(extraction.items.newServiceTemplates || [])].every(c => c.status !== 'pending');
    extraction.status = allApproved ? 'completed' : 'partial';
    writeFileSync(filePath, JSON.stringify(extraction, null, 2), 'utf-8');

    res.json({ success: true, added, extraction });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reject items from an extraction
app.post('/api/extractions/:id/reject', (req, res) => {
  try {
    const id = req.params.id;
    if (id.includes('..') || id.includes('/')) return res.status(400).json({ error: 'Invalid ID' });
    const filePath = join(DATA_DIR, 'knowledge', 'pending-extractions', `${id}.json`);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Extraction not found' });

    const extraction = JSON.parse(readFileSync(filePath, 'utf-8'));
    const { rejectedIds } = req.body || {};

    for (const clause of (extraction.items.newClauses || [])) {
      if (rejectedIds && !rejectedIds.includes(clause.id)) continue;
      if (clause.status === 'pending') clause.status = 'rejected';
    }
    for (const tmpl of (extraction.items.newServiceTemplates || [])) {
      if (rejectedIds && !rejectedIds.includes(tmpl.type)) continue;
      if (tmpl.status === 'pending') tmpl.status = 'rejected';
    }

    const allDone = [...(extraction.items.newClauses || []), ...(extraction.items.newServiceTemplates || [])].every(i => i.status !== 'pending');
    extraction.status = allDone ? 'completed' : 'partial';
    writeFileSync(filePath, JSON.stringify(extraction, null, 2), 'utf-8');

    res.json({ success: true, extraction });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Client CRUD endpoints ────────────────────────────────────────────────────

app.get('/api/clients', (_req, res) => {
  try {
    const data = loadClients();
    data.clients.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
    res.json(data);
  } catch (err) {
    console.error('Error reading clients:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', (req, res) => {
  try {
    const { name, company, contactName, email, phone, notes, defaultPaymentStructure } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    const data = loadClients();
    const id = generateClientId(name);

    // Check for duplicate ID
    if (data.clients.find(c => c.id === id)) {
      return res.status(409).json({ error: 'Client with this name already exists' });
    }

    const now = new Date().toISOString();
    const client = {
      id,
      name: name.trim(),
      company: company || '',
      contactName: contactName || '',
      email: email || '',
      phone: phone || '',
      notes: notes || '',
      defaultPaymentStructure: defaultPaymentStructure || '',
      createdAt: now,
      updatedAt: now,
    };

    data.clients.push(client);
    saveClients(data);

    res.status(201).json(client);
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET match must be before /:id to avoid Express matching "match" as an id param
app.get('/api/clients/match', (req, res) => {
  try {
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ clients: [] });
    const data = loadClients();
    const matches = data.clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    ).slice(0, 10).map(c => ({ id: c.id, name: c.name, company: c.company }));
    res.json({ clients: matches });
  } catch (err) {
    console.error('Error matching clients:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }

    const data = loadClients();
    const client = data.clients.find(c => c.id === id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Include linked projects
    const index = readIndex();
    const projects = index.projects.filter(p => p.clientId === id);

    res.json({ ...client, projects });
  } catch (err) {
    console.error('Error reading client:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }

    const data = loadClients();
    const idx = data.clients.findIndex(c => c.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { name, company, contactName, email, phone, notes, defaultPaymentStructure } = req.body;
    const existing = data.clients[idx];

    data.clients[idx] = {
      ...existing,
      name: name !== undefined ? name.trim() : existing.name,
      company: company !== undefined ? company : existing.company,
      contactName: contactName !== undefined ? contactName : existing.contactName,
      email: email !== undefined ? email : existing.email,
      phone: phone !== undefined ? phone : existing.phone,
      notes: notes !== undefined ? notes : existing.notes,
      defaultPaymentStructure: defaultPaymentStructure !== undefined ? defaultPaymentStructure : existing.defaultPaymentStructure,
      updatedAt: new Date().toISOString(),
    };

    saveClients(data);
    res.json(data.clients[idx]);
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }

    const data = loadClients();
    const idx = data.clients.findIndex(c => c.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Client not found' });
    }

    data.clients.splice(idx, 1);
    saveClients(data);

    // Unlink projects that reference this client
    const index = readIndex();
    let indexChanged = false;
    for (const entry of index.projects) {
      if (entry.clientId === id) {
        delete entry.clientId;
        indexChanged = true;
        // Also update the project.json
        try {
          const project = readProject(entry.id);
          if (project.clientId === id) {
            delete project.clientId;
            writeProject(entry.id, project);
          }
        } catch { /* project file missing, skip */ }
      }
    }
    if (indexChanged) writeIndex(index);

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting client:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients/match', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const data = loadClients();
    const matches = fuzzyMatchClient(name, data.clients).map(m => ({
      id: m.id,
      name: m.name,
      company: m.company,
      score: m.score,
    }));

    res.json({ matches });
  } catch (err) {
    console.error('Error matching client:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Project CRUD endpoints ───────────────────────────────────────────────────

app.get('/api/projects', (_req, res) => {
  try {
    res.json(readIndex());
  } catch (err) {
    console.error('Error reading projects index:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const { name, clientId } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const id = slugify(name);
    const projDir = getProjectPath(id);
    if (!projDir) {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    mkdirSync(join(projDir, 'output'), { recursive: true });
    mkdirSync(join(projDir, 'uploads'), { recursive: true });

    const project = {
      name: name.trim(),
      id,
      createdAt: new Date().toISOString(),
      chatHistory: [],
      formStates: {},
      activeDocType: 'quote',
    };
    if (clientId) project.clientId = clientId;

    writeProject(id, project);

    const index = readIndex();
    const entry = { id, name: name.trim(), createdAt: project.createdAt, clientName: '', docType: '', docCount: 0, lastModified: project.createdAt };
    if (clientId) entry.clientId = clientId;
    index.projects.push(entry);
    writeIndex(index);

    res.status(201).json(project);
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ error: err.message });
  }
});

// NOTE: /active must be defined BEFORE /:id to avoid Express matching "active" as an id param
app.put('/api/projects/active', (req, res) => {
  try {
    const { projectId } = req.body;
    const index = readIndex();
    index.activeProjectId = projectId || null;
    writeIndex(index);
    res.json({ success: true, activeProjectId: index.activeProjectId });
  } catch (err) {
    console.error('Error setting active project:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    const project = readProject(id);
    res.json(project);
  } catch (err) {
    console.error('Error reading project:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    const { name, clientId } = req.body;

    const project = readProject(id);
    if (name && typeof name === 'string' && name.trim()) {
      project.name = name.trim();
    }
    writeProject(id, project);

    const index = readIndex();
    const entry = index.projects.find(p => p.id === id);
    if (entry) {
      if (name && typeof name === 'string' && name.trim()) entry.name = name.trim();
      if (clientId !== undefined) {
        if (clientId) {
          entry.clientId = clientId;
        } else {
          delete entry.clientId;
        }
      }
      writeIndex(index);
    }

    res.json(project);
  } catch (err) {
    console.error('Error updating project:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    const projDir = join(PROJECTS_DIR, id);
    rmSync(projDir, { recursive: true, force: true });

    const index = readIndex();
    index.projects = index.projects.filter(p => p.id !== id);
    if (index.activeProjectId === id) {
      index.activeProjectId = null;
    }
    writeIndex(index);

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ error: err.message });
  }
});

// (demo endpoints moved below project routes)

function handleSaveChat(req, res) {
  try {
    const { id } = req.params;
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    const { chatHistory } = req.body;
    if (!Array.isArray(chatHistory)) {
      return res.status(400).json({ error: 'chatHistory must be an array' });
    }

    const project = readProject(id);
    project.chatHistory = chatHistory;
    writeProject(id, project);

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving chat history:', err);
    res.status(500).json({ error: err.message });
  }
}
app.put('/api/projects/:id/chat', handleSaveChat);
app.post('/api/projects/:id/chat', handleSaveChat);

function handleSaveForm(req, res) {
  try {
    const { id } = req.params;
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    const { formState, docType } = req.body;

    const project = readProject(id);
    const effectiveDocType = docType || formState?.docType || project.activeDocType || 'quote';
    if (!project.formStates) project.formStates = {};
    project.formStates[effectiveDocType] = formState;
    project.activeDocType = effectiveDocType;
    // Migration cleanup: remove old formState if it exists
    if (project.formState) delete project.formState;
    writeProject(id, project);

    // Update index metadata from form state
    const index = readIndex();
    const entry = index.projects.find(p => p.id === id);
    if (entry) {
      entry.clientName = (formState && formState.clientName) || entry.clientName || '';
      entry.docType = effectiveDocType;
      entry.docTypes = Object.keys(project.formStates).filter(k => project.formStates[k] != null);
      entry.lastModified = new Date().toISOString();
      // Count output files
      try {
        const outputDir = join(PROJECTS_DIR, id, 'output');
        if (existsSync(outputDir)) {
          entry.docCount = readdirSync(outputDir).filter(f => !f.startsWith('.')).length;
        }
      } catch { /* ignore */ }
      writeIndex(index);
    }

    // Client auto-linking: if formState has clientName and project has no clientId
    let clientLinked = false;
    let suggestedClient = null;
    const clientName = formState && formState.clientName;
    if (clientName && !project.clientId) {
      const clientsData = loadClients();
      const matches = fuzzyMatchClient(clientName, clientsData.clients);
      if (matches.length > 0 && matches[0].score === 100) {
        // Exact match — auto-link
        project.clientId = matches[0].id;
        writeProject(id, project);
        const idx2 = readIndex();
        const e2 = idx2.projects.find(p => p.id === id);
        if (e2) { e2.clientId = matches[0].id; writeIndex(idx2); }
        clientLinked = true;
      } else if (matches.length > 0 && matches[0].score >= 50) {
        // Fuzzy match — suggest
        suggestedClient = { id: matches[0].id, name: matches[0].name, company: matches[0].company, score: matches[0].score };
      } else {
        // No match — auto-create client
        const newId = generateClientId(clientName);
        if (!clientsData.clients.find(c => c.id === newId)) {
          const now = new Date().toISOString();
          const newClient = {
            id: newId,
            name: clientName.trim(),
            company: (formState.clientCompany || '').trim(),
            contactName: '',
            email: '',
            phone: '',
            notes: '',
            defaultPaymentStructure: '',
            createdAt: now,
            updatedAt: now,
          };
          clientsData.clients.push(newClient);
          saveClients(clientsData);
        }
        project.clientId = newId;
        writeProject(id, project);
        const idx3 = readIndex();
        const e3 = idx3.projects.find(p => p.id === id);
        if (e3) { e3.clientId = newId; writeIndex(idx3); }
        clientLinked = true;
      }
    }

    const result = { success: true, clientLinked };
    if (suggestedClient) result.suggestedClient = suggestedClient;
    res.json(result);
  } catch (err) {
    console.error('Error saving form state:', err);
    res.status(500).json({ error: err.message });
  }
}
app.put('/api/projects/:id/form', handleSaveForm);
app.post('/api/projects/:id/form', handleSaveForm);

// ─── Demo data endpoints ───────────────────────────────────────────────────────

app.post('/api/load-demo', (req, res) => {
  try {
    const now = new Date().toISOString();

    // Create demo client
    const demoClient = {
      id: 'demo-client',
      name: 'סטודיו לדוגמה בע״מ',
      company: 'סטודיו לדוגמה',
      contactName: 'ישראל ישראלי',
      email: 'demo@example.com',
      phone: '050-000-0000',
      notes: 'לקוח לדוגמה — ניתן למחוק',
      defaultPaymentStructure: '',
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    };

    const clientsData = loadClients();
    clientsData.clients = clientsData.clients.filter(c => c.id !== 'demo-client');
    clientsData.clients.push(demoClient);
    saveClients(clientsData);

    // Create demo project
    const demoProject = {
      name: 'פרויקט לדוגמה — עיצוב אתר',
      id: 'demo-project',
      clientId: 'demo-client',
      isDemo: true,
      createdAt: now,
      lastModified: now,
      activeDocType: 'quote',
      docTypes: ['quote'],
      chatHistory: [],
      formStates: {
        quote: {
          clientName: 'סטודיו לדוגמה בע״מ',
          company: 'סטודיו לדוגמה',
          docType: 'quote',
          projectDescription: 'עיצוב ופיתוח אתר תדמית לעסק',
          serviceDetails: 'עיצוב אתר תדמית בן 5 עמודים כולל: עמוד בית, אודות, שירותים, תיק עבודות ויצירת קשר.\nעיצוב רספונסיבי מלא למובייל וטאבלט.\nהתאמת צבעים וטיפוגרפיה למיתוג הלקוח.\nהטמעת טופס יצירת קשר.',
          pricingItems: [
            { desc: 'עיצוב אתר תדמית — 5 עמודים', qty: 1, price: 8000, option: '' },
            { desc: 'תוספת — בלוג / מערכת תוכן', qty: 1, price: 2000, option: 'אופציה' }
          ],
          paymentStructure: '2-installments',
          timeline: 'שלב א׳ — אפיון ועיצוב: שבוע 1-2\nשלב ב׳ — פיתוח: שבוע 3-5\nשלב ג׳ — תיקונים ואספקה: שבוע 6',
          notes: 'המחיר אינו כולל מע״מ.\nההצעה בתוקף ל-30 יום.\nכולל 2 סבבי תיקונים.',
          documentDate: now.split('T')[0],
          selectedClauses: ['advance-payment', 'late-payment', 'right-to-terminate', 'ip-transfer', 'revision-rounds', 'governing-law', 'force-majeure', 'amendments-in-writing', 'client-materials', 'mutual-nda', 'project-completion'],
        }
      }
    };

    writeProject('demo-project', demoProject);

    // Add to index
    const index = readIndex();
    const existing = index.projects.findIndex(p => p.id === 'demo-project');
    const entry = {
      id: 'demo-project',
      name: demoProject.name,
      createdAt: now,
      clientId: 'demo-client',
      clientName: demoClient.name,
      docType: 'quote',
      docCount: 0,
      lastModified: now,
      isDemo: true,
    };
    if (existing >= 0) {
      index.projects[existing] = entry;
    } else {
      index.projects.push(entry);
    }
    writeIndex(index);

    res.json({ ok: true, clientId: demoClient.id, projectId: demoProject.id });
  } catch (err) {
    console.error('Load demo error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/demo-data', (req, res) => {
  try {
    // Remove demo client
    const clientsData = loadClients();
    clientsData.clients = clientsData.clients.filter(c => c.id !== 'demo-client');
    saveClients(clientsData);

    // Remove demo project from index
    const index = readIndex();
    index.projects = index.projects.filter(p => p.id !== 'demo-project');
    if (index.activeProjectId === 'demo-project') index.activeProjectId = null;
    writeIndex(index);

    // Remove demo project directory
    const projDir = join(PROJECTS_DIR, 'demo-project');
    rmSync(projDir, { recursive: true, force: true });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete demo error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Existing endpoint: POST /api/chat ────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages, system, formContext, projectId } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Build system prompt with live form context
  let systemPrompt = system || getSystemPrompt();
  if (formContext) {
    systemPrompt += '\n\n## מצב הטופס הנוכחי (בזמן אמת)\n';
    systemPrompt += 'להלן המצב הנוכחי של הטופס שהמשתמש עובד עליו. השתמש במידע זה כדי לתת תשובות מדויקות ורלוונטיות.\n\n';
    if (formContext.clientName) systemPrompt += `- **שם לקוח:** ${formContext.clientName}\n`;
    if (formContext.clientCompany) systemPrompt += `- **חברה:** ${formContext.clientCompany}\n`;
    if (formContext.docType) {
      const docTypeNames = { quote: 'הצעת מחיר', order: 'הזמנת עבודה', contract: 'חוזה' };
      systemPrompt += `- **סוג מסמך:** ${docTypeNames[formContext.docType] || formContext.docType}\n`;
    }
    if (formContext.serviceType) systemPrompt += `- **סוג שירות/תבנית:** ${formContext.serviceType}\n`;
    if (formContext.projectDescription) systemPrompt += `- **תיאור פרויקט:** ${formContext.projectDescription}\n`;
    if (formContext.serviceDetails) systemPrompt += `- **פרטי שירות:** ${formContext.serviceDetails}\n`;
    if (formContext.pricingItems && formContext.pricingItems.length > 0) {
      const validItems = formContext.pricingItems.filter(p => p.desc || p.price);
      if (validItems.length > 0) {
        systemPrompt += `- **פריטי תמחור:**\n`;
        validItems.forEach(p => {
          systemPrompt += `  - ${p.desc || '(ללא תיאור)'}: ${p.qty} x ${p.price} ₪\n`;
        });
        const total = validItems.reduce((sum, p) => sum + (p.qty * p.price), 0);
        systemPrompt += `  - **סה"כ: ${total.toLocaleString()} ₪**\n`;
      }
    }
    if (formContext.paymentStructure) {
      const structNames = { two: 'שני תשלומים (35%/65%)', three: 'שלושה תשלומים (40%/30%/30%)', custom: 'מותאם אישית' };
      systemPrompt += `- **מבנה תשלומים:** ${structNames[formContext.paymentStructure] || formContext.paymentStructure}\n`;
      if (formContext.paymentStructure === 'custom' && formContext.customInstallments) {
        systemPrompt += `  - חלוקה: ${formContext.customInstallments.join('% / ')}%\n`;
      }
    }
    if (formContext.timeline) systemPrompt += `- **לוח זמנים:** ${formContext.timeline}\n`;
    if (formContext.notes) systemPrompt += `- **הערות:** ${formContext.notes}\n`;
    if (formContext.selectedClauses && formContext.selectedClauses.length > 0) {
      systemPrompt += `- **סעיפים נבחרים (${formContext.selectedClauses.length}):** ${formContext.selectedClauses.join(', ')}\n`;
    }
    if (formContext.clauseEdits && Object.keys(formContext.clauseEdits).length > 0) {
      systemPrompt += `- **סעיפים שנערכו:**\n`;
      for (const [id, text] of Object.entries(formContext.clauseEdits)) {
        systemPrompt += `  - ${id}: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}\n`;
      }
    }
    if (formContext.sectionToggles) {
      const toggleEntries = Object.entries(formContext.sectionToggles);
      if (toggleEntries.length > 0) {
        systemPrompt += `- **סקציות מופעלות/כבויות:**\n`;
        toggleEntries.forEach(([section, enabled]) => {
          systemPrompt += `  - ${section}: ${enabled ? 'מופעל' : 'כבוי'}\n`;
        });
      }
    }
  }

  // Add awareness of all document types in this project
  if (projectId) {
    try {
      const project = readProject(projectId);
      if (project && project.formStates) {
        const docTypeNames = { quote: 'הצעת מחיר', order: 'הזמנת עבודה', contract: 'חוזה' };
        const existingDocs = Object.keys(project.formStates)
          .filter(k => project.formStates[k] != null)
          .map(k => {
            const state = project.formStates[k];
            const isActive = k === project.activeDocType;
            const client = state.clientName || '';
            return `- ${docTypeNames[k] || k}: ${isActive ? '✓ (פעיל)' : '✓'}${client ? ' — לקוח: ' + client : ''}`;
          });
        if (existingDocs.length > 0) {
          systemPrompt += '\n\nמסמכים קיימים בפרויקט:\n' + existingDocs.join('\n');
        }
      }
    } catch { /* project not found, skip */ }
  }

  // Add client context if project is linked to a client
  if (projectId) {
    try {
      const project = readProject(projectId);
      if (project && project.clientId) {
        const clientsData = loadClients();
        const client = clientsData.clients.find(c => c.id === project.clientId);
        if (client) {
          const projectIndex = readIndex();
          const clientProjects = projectIndex.projects.filter(p => p.clientId === client.id);
          systemPrompt += '\n\n## לקוח נוכחי\n';
          systemPrompt += `- שם: ${client.name}\n`;
          if (client.company) systemPrompt += `- חברה: ${client.company}\n`;
          if (client.email) systemPrompt += `- אימייל: ${client.email}\n`;
          if (client.phone) systemPrompt += `- טלפון: ${client.phone}\n`;
          systemPrompt += `- פרויקטים קודמים: ${clientProjects.length}\n`;
          if (client.defaultPaymentStructure) systemPrompt += `- מבנה תשלומים מועדף: ${client.defaultPaymentStructure}\n`;
          if (client.notes) systemPrompt += `- הערות: ${client.notes}\n`;
        }
      }
    } catch { /* client lookup failed, skip */ }
  }

  let streamResult;
  try {
    streamResult = await chatCompletionStream({
      system: systemPrompt,
      messages,
      maxTokens: 16384,
    });
  } catch (err) {
    console.error('AI API error (chat):', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  try {
    for await (const chunk of parseSSEStream(streamResult.response, streamResult.provider)) {
      if (chunk.type === 'text') {
        res.write(`data: ${JSON.stringify({ type: 'text', text: chunk.text })}\n\n`);
      } else if (chunk.type === 'error') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }
  } catch (streamErr) {
    console.error('Stream error:', streamErr.message);
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

// ─── New endpoint: POST /api/generate-document ────────────────────────────────

app.post('/api/generate-document', async (req, res) => {
  try {
    const raw = req.body;

    if (!raw || typeof raw !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object with document data' });
    }

    // Map frontend field names to generateDocument() expected format
    const docTypeMap = { quote: 'quote', order: 'workOrder', contract: 'contract' };
    const paymentLabels = {
      two: [
        { percentage: 35, description: 'מקדמה בתחילת עבודה' },
        { percentage: 65, description: 'תשלום סופי עם סיום הפרויקט' },
      ],
      three: [
        { percentage: 40, description: 'מקדמה בתחילת עבודה' },
        { percentage: 30, description: 'תשלום שני באמצע הפרויקט' },
        { percentage: 30, description: 'תשלום סופי עם סיום הפרויקט' },
      ],
    };

    let installments = [];
    if (raw.paymentTerms) {
      if (raw.paymentTerms.type === 'custom') {
        installments = (raw.paymentTerms.installments || []).map((pct, i) => ({
          percentage: pct,
          description: `תשלום ${i + 1}`,
        }));
      } else {
        installments = paymentLabels[raw.paymentTerms.type] || [];
      }
    }

    const data = {
      clientName: raw.clientName || '',
      clientCompany: raw.clientCompany || '',
      documentType: docTypeMap[raw.docType] || raw.documentType || 'quote',
      projectDescription: raw.projectDescription || '',
      serviceDetails: raw.serviceDetails || '',
      pricingItems: (raw.pricing || raw.pricingItems || []).map(item => ({
        description: item.desc || item.description || '',
        quantity: item.qty || item.quantity || 1,
        unitPrice: item.price || item.unitPrice || 0,
        option: item.option || '',
      })),
      paymentTerms: {
        type: raw.paymentTerms?.type || 'two',
        installments,
      },
      timeline: raw.timeline || '',
      generalNotes: raw.notes || raw.generalNotes || '',
      serviceType: raw.serviceType || '',
      selectedClauses: raw.selectedClauses || null,
      clauseEdits: raw.clauseEdits || {},
      documentDate: raw.documentDate || null,
    };

    // Clear content for disabled sections
    const disabled = new Set(raw.disabledSections || []);
    if (disabled.has('pricing')) {
      data.pricingItems = [];
    }
    if (disabled.has('payment')) {
      data.paymentTerms = { type: 'none', installments: [] };
    }
    if (disabled.has('timeline')) {
      data.timeline = '';
    }
    if (disabled.has('notes')) {
      data.generalNotes = '';
    }

    const buffer = await generateDocument({ ...data, userProfile });

    // Build a descriptive Hebrew filename
    const typeNames = { quote: 'הצעת מחיר', contract: 'חוזה', workOrder: 'הזמנת עבודה' };
    const docTypeName = typeNames[data.documentType] || 'מסמך';
    const clientName = (data.clientName || '').trim();
    const projectDesc = (data.projectDescription || '').trim();

    // Short project description (first meaningful chunk, max ~40 chars)
    let shortDesc = projectDesc.split(/[.\n,]/)[0].trim();
    if (shortDesc.length > 40) shortDesc = shortDesc.slice(0, 40).trim();

    // Format date as DD.MM.YY
    const docDate = raw.documentDate ? new Date(raw.documentDate + 'T00:00:00') : new Date();
    const dateStr = `${docDate.getDate()}.${docDate.getMonth() + 1}.${String(docDate.getFullYear()).slice(-2)}`;

    // Determine save path first (needed for sequence number)
    let savePath = OUTPUT_DIR;
    if (raw.projectId) {
      const projOutput = getProjectPath(raw.projectId, 'output');
      if (projOutput) savePath = projOutput;
    }

    // Sequence number: count existing files for this doc type in the output directory
    let seq = 1;
    try {
      const existing = readdirSync(savePath).filter(f => f.endsWith('.docx'));
      const sameType = existing.filter(f => f.startsWith(docTypeName));
      seq = sameType.length + 1;
    } catch { /* dir might not exist yet */ }

    // Build filename parts
    const parts = [docTypeName];
    if (shortDesc) parts.push(shortDesc);
    if (clientName) parts.push(`עבור ${clientName}`);
    parts.push(dateStr);
    parts.push(String(seq));

    // Clean filename: allow Hebrew, digits, spaces, hyphens, dots
    const filename = parts.join(' - ')
      .replace(/[^\w\u0590-\u05ff\s.\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim() + '.docx';

    const outputPath = join(savePath, filename);

    // Save to output directory
    writeFileSync(outputPath, buffer);

    // Auto-open in default application (LibreOffice etc.)
    exec(`xdg-open "${outputPath}"`, (err) => {
      if (err) console.error('Failed to open document:', err.message);
    });

    // Update project doc count in index
    if (raw.projectId) {
      try {
        const index = readIndex();
        const entry = index.projects.find(p => p.id === raw.projectId);
        if (entry) {
          const outputDir = join(PROJECTS_DIR, raw.projectId, 'output');
          if (existsSync(outputDir)) {
            entry.docCount = readdirSync(outputDir).filter(f => !f.startsWith('.')).length;
          }
          entry.lastModified = new Date().toISOString();
          writeIndex(index);
        }
      } catch { /* ignore */ }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (err) {
    console.error('Document generation error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate document' });
  }
});

// ─── Endpoint: POST /api/upload ──────────────────────────────────────────────

app.post('/api/upload', dynamicUpload.array('files', 20), (req, res) => {
  try {
    // Support both single file (field "file") and multiple files (field "files")
    const files = req.files || (req.file ? [req.file] : []);

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    res.json({
      success: true,
      uploaded: files.length,
      files: files.map(f => ({ filename: f.filename, originalName: f.originalname, size: f.size })),
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── New endpoint: GET /api/reference-documents ──────────────────────────────

app.get('/api/reference-documents', (_req, res) => {
  try {
    const subDirs = ['2025', 'Jan-Feb 2026'];
    const results = [];

    for (const sub of subDirs) {
      const subPath = join(REFERENCES_DIR, sub);
      let files;
      try {
        files = readdirSync(subPath);
      } catch {
        continue;
      }

      for (const name of files) {
        const ext = name.split('.').pop().toLowerCase();
        if (!['docx', 'doc', 'pdf'].includes(ext)) continue;
        const fullPath = join(subPath, name);
        const stat = statSync(fullPath);
        results.push({
          name,
          folder: sub,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }

    results.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ references: results });
  } catch (err) {
    console.error('Error listing reference docs:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── New endpoint: POST /api/analyze-document ─────────────────────────────────

app.post('/api/analyze-document', async (req, res) => {
  try {
    const { filename, source, projectId } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    // Prevent path traversal
    if (filename.includes('..') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    let filePath;
    if (source === 'references') {
      // Accept "2025/filename.docx" or "Jan-Feb 2026/filename.docx"
      const parts = filename.split('/');
      if (parts.length !== 2) {
        return res.status(400).json({ error: 'Reference filename must be in format "subfolder/filename"' });
      }
      const [subfolder, fname] = parts;
      const allowedSubfolders = ['2025', 'Jan-Feb 2026'];
      if (!allowedSubfolders.includes(subfolder)) {
        return res.status(400).json({ error: 'Invalid subfolder' });
      }
      filePath = join(REFERENCES_DIR, subfolder, fname);
    } else if (projectId) {
      // Project-specific uploads folder
      const projUploads = getProjectPath(projectId, 'uploads');
      if (!projUploads) {
        return res.status(400).json({ error: 'Invalid project ID' });
      }
      filePath = join(projUploads, filename);
    } else {
      // Default: uploads directory
      filePath = join(UPLOADS_DIR, filename);
    }

    // Check file exists
    try {
      statSync(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = filename.split('.').pop().toLowerCase();
    let extractedText = '';

    if (ext === 'docx' || ext === 'doc') {
      const result = await mammoth.extractRawText({ path: filePath });
      extractedText = result.value;
    } else if (ext === 'pdf') {
      const buffer = readFileSync(filePath);
      const pdfData = await getPdfParser().parse(buffer);
      extractedText = pdfData.text;
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Only DOCX and PDF files can be analyzed.' });
    }

    if (!extractedText || extractedText.trim().length < 10) {
      return res.status(422).json({ error: 'Could not extract text from this file. It may be image-based or corrupted.' });
    }

    const systemPrompt = `אתה מנתח מסמכים עסקיים בעברית. קיבלת תוכן של מסמך עסקי (הצעת מחיר, חוזה, או הזמנת עבודה).
נתח את המסמך והחזר JSON עם המידע הבא:

{
  "clientName": "שם הלקוח",
  "clientCompany": "שם החברה של הלקוח",
  "documentType": "quote" | "contract" | "workOrder",
  "projectDescription": "תיאור קצר של הפרויקט",
  "serviceDetails": "פירוט מלא של השירות",
  "pricingItems": [{"desc": "תיאור", "qty": מספר, "price": מספר}],
  "paymentStructure": "two" | "three" | "custom",
  "timeline": "פרטי לוחות זמנים",
  "generalNotes": "הערות כלליות",
  "styleNotes": "הערות לגבי סגנון המסמך, עיצוב, מבנה"
}

החזר רק JSON תקין, ללא טקסט נוסף. אם שדה לא נמצא במסמך, השאר אותו כמחרוזת ריקה או מערך ריק.
מחירים צריכים להיות מספרים בלבד (ללא סימן ₪ או פסיקים).`;

    let apiData;
    try {
      apiData = await chatCompletion({
        system: systemPrompt,
        messages: [{ role: 'user', content: `נתח את המסמך הבא והחזר JSON:\n\n${extractedText.slice(0, 20000)}` }],
        maxTokens: 4096,
      });
    } catch (err) {
      console.error('AI API error (analyze-document):', err.message);
      return res.status(502).json({ error: err.message });
    }

    const rawText = apiData.text;
    console.log(`[analyze-document] AI response length: ${rawText?.length || 0}`);

    const extracted = extractJSON(rawText);
    if (!extracted) {
      console.error('[analyze-document] Failed to parse JSON. Raw:', rawText?.slice(0, 500));
      return res.status(502).json({ error: 'Claude did not return valid JSON', raw: rawText?.slice(0, 500) });
    }

    console.log('[analyze-document] Successfully parsed JSON');
    res.json({ success: true, data: extracted, filename });
  } catch (err) {
    console.error('Analyze document error:', err);
    res.status(500).json({ error: err.message || 'Failed to analyze document' });
  }
});

// ─── New endpoint: GET /api/documents (combined) ──────────────────────────────
// Replaces the old split endpoints - returns both generated and uploaded files

app.get('/api/documents', (req, res) => {
  try {
    const { projectId } = req.query;
    let outputDir = OUTPUT_DIR;
    let uploadsDir = UPLOADS_DIR;

    if (projectId) {
      const projOutput = getProjectPath(projectId, 'output');
      const projUploads = getProjectPath(projectId, 'uploads');
      if (projOutput && projUploads) {
        outputDir = projOutput;
        uploadsDir = projUploads;
      }
    }

    const generated = readdirSync(outputDir)
      .filter(f => f.endsWith('.docx') || f.endsWith('.pdf'))
      .map(name => {
        const stat = statSync(join(outputDir, name));
        return { name, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    const uploaded = readdirSync(uploadsDir)
      .map(name => {
        const stat = statSync(join(uploadsDir, name));
        return { name, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json({ generated, uploaded });
  } catch (err) {
    console.error('Error listing documents:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── New endpoint: GET /api/download/:folder/:filename ────────────────────────

app.get('/api/download/:folder/:filename', (req, res) => {
  try {
    const { folder, filename } = req.params;
    const { projectId } = req.query;

    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    let basePath;
    if (projectId) {
      // Project-specific path
      const projPath = getProjectPath(projectId, folder);
      if (!projPath) {
        return res.status(400).json({ error: 'Invalid project ID' });
      }
      basePath = projPath;
    } else if (folder === 'output') {
      basePath = OUTPUT_DIR;
    } else if (folder === 'uploads') {
      basePath = UPLOADS_DIR;
    } else {
      return res.status(400).json({ error: 'Invalid folder' });
    }

    const filePath = join(basePath, filename);
    try {
      statSync(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.sendFile(filePath);
  } catch (err) {
    console.error('Error serving file:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Learn references endpoint ────────────────────────────────────────────────

app.post('/api/learn-references', async (req, res) => {
  try {
    // Scan ALL reference documents recursively — no hardcoded paths
    const extractedDocs = [];
    const seenNames = new Set();

    function collectFiles(dir, relPath) {
      let entries;
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries) {
        const fullPath = join(dir, name);
        const rel = relPath ? `${relPath}/${name}` : name;
        try {
          if (statSync(fullPath).isDirectory()) {
            collectFiles(fullPath, rel);
            continue;
          }
        } catch { continue; }
        const ext = name.split('.').pop().toLowerCase();
        if (!['docx', 'pdf'].includes(ext)) continue;
        const baseName = name.replace(/\.(docx|pdf)$/i, '');
        if (seenNames.has(baseName)) continue;
        // Prefer .docx over .pdf — check if docx sibling exists
        if (ext === 'pdf' && entries.includes(baseName + '.docx')) continue;
        seenNames.add(baseName);
        collectedFiles.push({ fullPath, displayName: rel });
      }
    }

    const collectedFiles = [];
    collectFiles(REFERENCES_DIR, '');
    console.log('[learn-references] REFERENCES_DIR:', REFERENCES_DIR);
    // Debug: list actual files in the directory
    try {
      const dirContents = readdirSync(REFERENCES_DIR);
      console.log('[learn-references] Dir contents (' + dirContents.length + '):', dirContents.slice(0, 10).join(', '));
    } catch (e) { console.log('[learn-references] Cannot list dir:', e.code); }
    console.log('[learn-references] Found', collectedFiles.length, 'documents (docx/pdf only)');

    for (const { fullPath, displayName } of collectedFiles) {
      const ext = displayName.split('.').pop().toLowerCase();
      let text = '';
      try {
        if (ext === 'docx') {
          const result = await mammoth.extractRawText({ path: fullPath });
          text = result.value;
        } else if (ext === 'pdf') {
          const buffer = readFileSync(fullPath);
          const pdfData = await getPdfParser().parse(buffer);
          text = pdfData.text;
        }
      } catch (err) {
        console.error(`Error extracting text from ${displayName}:`, err.message);
        continue;
      }

      if (text && text.trim().length > 10) {
        extractedDocs.push({ name: displayName, text: text.slice(0, 15000) });
      }
    }

    if (extractedDocs.length === 0) {
      return res.status(404).json({ error: 'No reference documents found to analyze' });
    }

    // Load existing clauses DB for reference
    let existingDb = null;
    try {
      const raw = JSON.parse(readFileSync(join(KNOWLEDGE_DIR, 'clauses-db.json'), 'utf-8'));
      // Validate schema: clauses must be a non-null object
      if (raw && typeof raw.clauses === 'object' && raw.clauses !== null && !Array.isArray(raw.clauses)) {
        existingDb = raw;
      }
    } catch { /* no existing DB or invalid JSON */ }

    const existingClauseIds = existingDb?.clauses
      ? Object.values(existingDb.clauses).flatMap(cat => (cat?.clauses || []).map(c => c.id))
      : [];

    const systemPrompt = buildExtractionPrompt(existingClauseIds);

    // Process documents in batches of ~15K chars each to avoid timeouts
    const BATCH_CHAR_LIMIT = 15000;
    const batches = [];
    let currentBatch = [];
    let currentChars = 0;
    for (const doc of extractedDocs) {
      if (currentChars + doc.text.length > BATCH_CHAR_LIMIT && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentChars = 0;
      }
      currentBatch.push(doc);
      currentChars += doc.text.length;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    console.log(`[learn-references] Processing ${extractedDocs.length} docs in ${batches.length} batches`);

    // Process each batch and collect all parsed results
    const allParsedResults = [];
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchText = batch
        .map((doc, j) => `=== מסמך ${j + 1}: ${doc.name} ===\n${doc.text}`)
        .join('\n\n---\n\n');
      console.log(`[learn-references] Batch ${i + 1}/${batches.length}: ${batch.length} docs, ${batchText.length} chars`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);

      try {
        const apiData = await chatCompletion({
          system: systemPrompt,
          messages: [{ role: 'user', content: `נתח את ${batch.length} המסמכים הבאים והחזר JSON מלא:\n\n${batchText}` }],
          maxTokens: 16384,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const rawText = apiData.text;
        console.log(`[learn-references] Batch ${i + 1} response: ${rawText?.length || 0} chars`);

        const parsed = extractJSON(rawText);
        if (parsed) {
          allParsedResults.push(parsed);
        } else {
          console.error(`[learn-references] Batch ${i + 1} returned invalid JSON, skipping`);
        }
      } catch (err) {
        clearTimeout(timeout);
        console.error(`[learn-references] Batch ${i + 1} failed: ${err.message}, continuing...`);
      }
    }

    if (allParsedResults.length === 0) {
      return res.status(502).json({ error: 'All batches failed to return valid data' });
    }

    // Merge all batch results into one parsed object
    const parsed = { newClauses: [], paymentPatterns: [], serviceTemplates: [], profileData: {} };
    for (const r of allParsedResults) {
      if (r.newClauses) parsed.newClauses.push(...r.newClauses);
      if (r.paymentPatterns) parsed.paymentPatterns.push(...r.paymentPatterns);
      if (r.serviceTemplates) parsed.serviceTemplates.push(...r.serviceTemplates);
      if (r.profileData) Object.assign(parsed.profileData, r.profileData);
    }
    console.log(`[learn-references] Merged ${allParsedResults.length} batches: ${parsed.newClauses.length} clauses, ${parsed.serviceTemplates?.length || 0} templates`);

    // Merge new clauses into existing DB
    let db = existingDb || {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'extracted from reference documents',
      clauses: {
        paymentTerms: { category: 'תמורה ותנאי תשלום', clauses: [] },
        clientObligations: { category: 'התחייבויות הלקוח', clauses: [] },
        earlyTermination: { category: 'הפסקת עבודה מוקדמת', clauses: [] },
        deliveryProcess: { category: 'תהליך סיום ומסירה', clauses: [] },
        intellectualProperty: { category: 'קניין רוחני, רישוי ואחריות', clauses: [] },
        aiDisclaimers: { category: 'הצהרות לקוח (AI גנרטיבי)', clauses: [] },
        warrantyAndCompletion: { category: 'הגדרת "סיום" ותקופת אחריות', clauses: [] },
        revisions: { category: 'תיקונים והערות', clauses: [] },
        generalTerms: { category: 'תנאים כלליים', clauses: [] },
      },
      paymentPatterns: [],
      serviceTemplates: [],
      standardTerms: {},
    };

    let addedClauses = 0;
    let updatedClauses = 0;

    // Pre-compute text fingerprints for dedup
    const textFingerprints = {};
    for (const [catKey, catData] of Object.entries(db.clauses || {})) {
      textFingerprints[catKey] = new Map();
      for (const c of (catData?.clauses || [])) {
        if (!c.text) continue;
        const fp = c.text.replace(/\s+/g, ' ').trim().slice(0, 100);
        textFingerprints[catKey].set(fp, c.id);
      }
    }

    // Merge new clauses
    if (parsed.newClauses && Array.isArray(parsed.newClauses)) {
      for (const clause of parsed.newClauses) {
        if (!clause.category || !clause.id || !clause.text) continue;
        if (!db.clauses[clause.category]) continue;

        const existing = db.clauses[clause.category].clauses.find(c => c.id === clause.id);
        // Also check for text similarity to prevent near-duplicate clauses
        const normText = clause.text.replace(/\s+/g, ' ').trim().slice(0, 100);
        const catFingerprints = textFingerprints[clause.category];
        if (catFingerprints) {
          const existingId = catFingerprints.get(normText);
          if (existingId && existingId !== clause.id) continue; // skip near-duplicate
        }
        if (existing) {
          // Update if text is longer/more detailed
          if (clause.text.length > existing.text.length) {
            existing.text = clause.text;
            if (clause.appliesTo) existing.appliesTo = clause.appliesTo;
            if (clause.notes) existing.notes = clause.notes;
            updatedClauses++;
          }
        } else {
          // Add new clause
          db.clauses[clause.category].clauses.push({
            id: clause.id,
            text: clause.text,
            appliesTo: clause.appliesTo || ['contract', 'workOrder'],
            required: clause.required || false,
            ...(clause.notes ? { notes: clause.notes } : {}),
          });
          addedClauses++;
        }
      }
    }

    // Merge new service templates
    let addedTemplates = 0;
    if (parsed.newServiceTemplates && Array.isArray(parsed.newServiceTemplates)) {
      for (const template of parsed.newServiceTemplates) {
        if (!template.type || !template.name) continue;
        const existing = db.serviceTemplates.find(t => t.type === template.type);
        if (!existing) {
          db.serviceTemplates.push(template);
          addedTemplates++;
        }
      }
    }

    // Merge new payment patterns
    let addedPatterns = 0;
    if (parsed.newPaymentPatterns && Array.isArray(parsed.newPaymentPatterns)) {
      for (const pattern of parsed.newPaymentPatterns) {
        if (!pattern.id) continue;
        const existing = db.paymentPatterns.find(p => p.id === pattern.id);
        if (!existing) {
          db.paymentPatterns.push(pattern);
          addedPatterns++;
        }
      }
    }

    // Update standard terms if provided
    if (parsed.updatedStandardTerms) {
      db.standardTerms = { ...db.standardTerms, ...parsed.updatedStandardTerms };
    }

    db.updatedAt = new Date().toISOString();

    // Save updated clauses DB
    writeFileSync(join(KNOWLEDGE_DIR, 'clauses-db.json'), JSON.stringify(db, null, 2), 'utf-8');

    // Also save the raw learned context for the system prompt
    const learnedData = {
      learnedAt: new Date().toISOString(),
      documentsAnalyzed: extractedDocs.length,
      ...parsed,
    };
    writeFileSync(join(KNOWLEDGE_DIR, 'learned-context.json'), JSON.stringify(learnedData, null, 2), 'utf-8');
    learnedContext = learnedData;

    // Update in-memory clausesDb
    clausesDb = db;

    // Auto-populate user profile from extracted provider info
    let profileUpdated = false;
    if (parsed.providerProfile) {
      const pp = parsed.providerProfile;
      const profileFields = ['name', 'nameEn', 'company', 'companyHe', 'title', 'titleEn', 'email', 'website', 'phone'];
      for (const field of profileFields) {
        const val = (pp[field] || '').trim();
        // Skip placeholder values from AI
        if (!val || /not found|לא נמצא|unknown|N\/A/i.test(val)) continue;
        if (val && val !== userProfile[field]) {
          userProfile[field] = val;
          profileUpdated = true;
        }
      }
      if (profileUpdated) {
        userProfile.setupComplete = true;
        writeFileSync(USER_PROFILE_PATH, JSON.stringify(userProfile, null, 2), 'utf-8');
        console.log('[learn-references] Auto-populated user profile from documents:',
          profileFields.filter(f => pp[f]).join(', '));
      }
    }

    res.json({
      success: true,
      documentsAnalyzed: extractedDocs.length,
      addedClauses,
      updatedClauses,
      addedTemplates,
      addedPatterns,
      totalClauses: Object.values(db.clauses || {}).reduce((sum, cat) => sum + (cat?.clauses?.length || 0), 0),
      totalCategories: Object.keys(db.clauses || {}).length,
      profileUpdated,
    });
  } catch (err) {
    console.error('Learn references error:', err);
    res.status(500).json({ error: err.message || 'Failed to learn from references' });
  }
});

app.get('/api/learned-context', (_req, res) => {
  if (learnedContext) {
    res.json(learnedContext);
  } else {
    res.json({ learned: false });
  }
});

app.get('/api/clauses-db', (_req, res) => {
  if (clausesDb) {
    res.json(clausesDb);
  } else {
    res.json({ clauses: {}, serviceTemplates: [], paymentPatterns: [], standardTerms: {} });
  }
});

// ─── AI clause recommendation endpoint ────────────────────────────────────────

const recommendCache = new Map();
const RECOMMEND_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.post('/api/recommend-clauses', async (req, res) => {
  try {
    const { formContext } = req.body || {};
    if (!clausesDb || !clausesDb.clauses) {
      return res.status(400).json({ error: 'מאגר הסעיפים לא נטען — יש ללמוד מסמכים תחילה (לחץ "למד מכל המסמכים" בהגדרות)' });
    }

    const docType = formContext?.docType || 'quote';
    const docTypeKey = docType === 'order' ? 'workOrder' : docType === 'contract' ? 'contract' : 'quote';
    const docTypeNames = { quote: 'הצעת מחיר', order: 'הזמנת עבודה', contract: 'חוזה' };

    const serviceDetails = formContext?.serviceDetails || formContext?.serviceType || '';
    const projectDescription = formContext?.projectDescription || '';
    const pricingDescs = (formContext?.pricingItems || []).map(p => p.desc || p.description || '').filter(Boolean).join(', ');
    const totalPrice = (formContext?.pricingItems || []).reduce((s, p) => s + ((p.qty || p.quantity || 1) * (p.price || p.unitPrice || 0)), 0);

    // Cache key
    const cacheKey = `${docType}|${serviceDetails}|${projectDescription}|${pricingDescs}`;

    // Clean expired cache entries
    const now = Date.now();
    for (const [key, entry] of recommendCache) {
      if (now - entry.ts > RECOMMEND_CACHE_TTL) {
        recommendCache.delete(key);
      }
    }

    // Return cached result if valid
    if (recommendCache.has(cacheKey)) {
      const cached = recommendCache.get(cacheKey);
      if (now - cached.ts <= RECOMMEND_CACHE_TTL) {
        return res.json({ recommendations: cached.recommendations });
      }
    }

    // Build a flat list of clause IDs + names (+ notes) filtered to the current doc type
    const clauseList = [];
    for (const [, catData] of Object.entries(clausesDb.clauses)) {
      for (const clause of catData.clauses) {
        if (clause.appliesTo && clause.appliesTo.includes(docTypeKey)) {
          const label = clause.name || clause.id;
          clauseList.push(`${clause.id}: ${label}${clause.notes ? ' — ' + clause.notes : ''}`);
        }
      }
    }

    if (clauseList.length === 0) {
      return res.json({ recommendations: {} });
    }

    const prompt = `בהינתן הטופס הבא:
- סוג מסמך: ${docTypeNames[docType] || docType}
- שירות: ${serviceDetails}
- תיאור: ${projectDescription}
- פריטי תמחור: ${pricingDescs || 'לא צוינו'}
- סה"כ: ${totalPrice} ₪

דרג כל סעיף ברשימה הבאה לפי רלוונטיות לפרויקט הזה (0-100):
${clauseList.join('\n')}

החזר JSON בלבד ללא הסברים, בפורמט: {"clause-id": score, ...}`;

    const result = await chatCompletion({
      system: 'אתה מומחה חוזים ישראלי. קרא את הטופס ותן ציון רלוונטיות (0-100) לכל סעיף. החזר JSON בלבד.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1024,
    });

    // Parse JSON from response (strip any surrounding markdown)
    let recommendations = {};
    try {
      const raw = result.text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        recommendations = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      }
    } catch (parseErr) {
      console.error('[recommend-clauses] JSON parse error:', parseErr.message, 'raw:', result.text.slice(0, 200));
    }

    // Store in cache
    recommendCache.set(cacheKey, { recommendations, ts: Date.now() });

    res.json({ recommendations });
  } catch (err) {
    console.error('[recommend-clauses] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Save clause to living DB ─────────────────────────────────────────────────

app.post('/api/save-clause', (req, res) => {
  try {
    const { category, id, text, appliesTo, required, notes } = req.body;

    if (!category || !id || !text) {
      return res.status(400).json({ error: 'Missing required fields: category, id, text' });
    }

    // Load current DB and validate category against actual DB categories
    const dbPath = join(KNOWLEDGE_DIR, 'clauses-db.json');
    let db;
    try {
      db = JSON.parse(readFileSync(dbPath, 'utf-8'));
    } catch {
      // Create fresh DB if none exists
      db = {
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: 'extracted from reference documents',
        clauses: {
          paymentTerms: { category: 'תמורה ותנאי תשלום', clauses: [] },
          clientObligations: { category: 'התחייבויות הלקוח', clauses: [] },
          earlyTermination: { category: 'הפסקת עבודה מוקדמת', clauses: [] },
          deliveryProcess: { category: 'תהליך סיום ומסירה', clauses: [] },
          intellectualProperty: { category: 'קניין רוחני, רישוי ואחריות', clauses: [] },
          aiDisclaimers: { category: 'הצהרות לקוח (AI גנרטיבי)', clauses: [] },
          warrantyAndCompletion: { category: 'הגדרת "סיום" ותקופת אחריות', clauses: [] },
          revisions: { category: 'תיקונים והערות', clauses: [] },
          generalTerms: { category: 'תנאים כלליים', clauses: [] },
          confidentiality: { category: 'סודיות', clauses: [] },
          commercialResponsibility: { category: 'אחריות לשימוש מסחרי', clauses: [] },
          projectTermination: { category: 'סיום הפרויקט', clauses: [] },
        },
        paymentPatterns: [],
        serviceTemplates: [],
        standardTerms: {},
      };
    }

    if (!db.clauses[category]) {
      return res.status(400).json({ error: `Category ${category} not found in DB` });
    }

    // Check for existing clause with same ID
    const existingIdx = db.clauses[category].clauses.findIndex(c => c.id === id);
    const clauseObj = {
      id,
      text,
      appliesTo: appliesTo || ['contract', 'workOrder'],
      required: required || false,
      ...(notes ? { notes } : {}),
    };

    if (existingIdx >= 0) {
      // Update existing
      db.clauses[category].clauses[existingIdx] = clauseObj;
    } else {
      // Add new
      db.clauses[category].clauses.push(clauseObj);
    }

    db.updatedAt = new Date().toISOString();
    writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');

    // Update in-memory DB
    clausesDb = db;

    const totalClauses = Object.values(db.clauses).reduce((sum, cat) => sum + cat.clauses.length, 0);
    res.json({
      success: true,
      action: existingIdx >= 0 ? 'updated' : 'added',
      clauseId: id,
      category,
      totalClauses,
    });
  } catch (err) {
    console.error('Save clause error:', err);
    res.status(500).json({ error: err.message || 'Failed to save clause' });
  }
});

// ─── Service Templates CRUD ──────────────────────────────────────────────────

function readClausesDb() {
  const dbPath = join(KNOWLEDGE_DIR, 'clauses-db.json');
  return JSON.parse(readFileSync(dbPath, 'utf-8'));
}

function writeClausesDb(db) {
  const dbPath = join(KNOWLEDGE_DIR, 'clauses-db.json');
  db.updatedAt = new Date().toISOString();
  writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
  clausesDb = db;
}

app.post('/api/service-templates', (req, res) => {
  try {
    const { name, typicalPricing, typicalTimeline, typicalDeliverables, relevantClauses, settings } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const db = readClausesDb();
    const type = `custom-${Date.now()}`;
    const template = {
      type,
      name,
      typicalPricing: typicalPricing || [],
      typicalTimeline: typicalTimeline || '',
      typicalDeliverables: typicalDeliverables || '',
      relevantClauses: relevantClauses || [],
      exampleClients: [],
      settings: settings || null,
    };

    db.serviceTemplates = db.serviceTemplates || [];
    db.serviceTemplates.push(template);
    writeClausesDb(db);

    res.json(template);
  } catch (err) {
    console.error('Create template error:', err);
    res.status(500).json({ error: err.message || 'Failed to create template' });
  }
});

app.put('/api/service-templates/:type', (req, res) => {
  try {
    const { type } = req.params;
    const { name, typicalPricing, typicalTimeline, typicalDeliverables, relevantClauses, settings } = req.body;

    const db = readClausesDb();
    const idx = (db.serviceTemplates || []).findIndex(t => t.type === type);
    if (idx === -1) return res.status(404).json({ error: 'Template not found' });

    const existing = db.serviceTemplates[idx];
    const updated = {
      ...existing,
      name: name !== undefined ? name : existing.name,
      typicalPricing: typicalPricing !== undefined ? typicalPricing : existing.typicalPricing,
      typicalTimeline: typicalTimeline !== undefined ? typicalTimeline : existing.typicalTimeline,
      typicalDeliverables: typicalDeliverables !== undefined ? typicalDeliverables : existing.typicalDeliverables,
      relevantClauses: relevantClauses !== undefined ? relevantClauses : existing.relevantClauses,
      settings: settings !== undefined ? settings : existing.settings,
    };

    db.serviceTemplates[idx] = updated;
    writeClausesDb(db);

    res.json(updated);
  } catch (err) {
    console.error('Update template error:', err);
    res.status(500).json({ error: err.message || 'Failed to update template' });
  }
});

app.delete('/api/service-templates/:type', (req, res) => {
  try {
    const { type } = req.params;
    const db = readClausesDb();
    const idx = (db.serviceTemplates || []).findIndex(t => t.type === type);
    if (idx === -1) return res.status(404).json({ error: 'Template not found' });

    db.serviceTemplates.splice(idx, 1);
    writeClausesDb(db);

    res.json({ success: true, type });
  } catch (err) {
    console.error('Delete template error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete template' });
  }
});

// ─── Document Types API ──────────────────────────────────────────────────────
const DOC_TYPES_PATH = join(DATA_DIR, 'knowledge', 'document-types.json');

function loadDocumentTypes() {
  try {
    return JSON.parse(readFileSync(DOC_TYPES_PATH, 'utf-8'));
  } catch {
    // Seed from file or return empty
    return { version: 1, types: [] };
  }
}

app.get('/api/document-types', (_req, res) => {
  try {
    const data = loadDocumentTypes();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/document-types', (req, res) => {
  try {
    const data = loadDocumentTypes();
    const newType = req.body;
    if (!newType.id || !newType.name) return res.status(400).json({ error: 'id and name required' });
    // Check for duplicate
    if (data.types.find(t => t.id === newType.id)) return res.status(409).json({ error: 'Type already exists' });
    data.types.push(newType);
    writeFileSync(DOC_TYPES_PATH, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, type: newType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/document-types/:id', (req, res) => {
  try {
    const data = loadDocumentTypes();
    const idx = data.types.findIndex(t => t.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Type not found' });
    data.types[idx] = { ...data.types[idx], ...req.body };
    writeFileSync(DOC_TYPES_PATH, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, type: data.types[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/document-types/:id', (req, res) => {
  try {
    const data = loadDocumentTypes();
    const idx = data.types.findIndex(t => t.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Type not found' });
    if (data.types[idx].builtIn) return res.status(403).json({ error: 'Cannot delete built-in type' });
    data.types.splice(idx, 1);
    writeFileSync(DOC_TYPES_PATH, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Export/Import (Backup & Restore) ─────────────────────────────────────────

app.get('/api/export', (_req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipName = `contractor-backup-${timestamp}.tar.gz`;
    const zipPath = join(OUTPUT_DIR, zipName);
    execSync(`tar -czf "${zipPath}" -C "${PROJECT_DIR}" data/`, { timeout: 30000 });
    res.download(zipPath, zipName, () => {
      // Clean up after download
      try { rmSync(zipPath); } catch {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/import', upload.single('backup'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const backupPath = req.file.path;
    // Extract to project dir (overwrites data/ directory)
    execSync(`tar -xzf "${backupPath}" -C "${PROJECT_DIR}"`, { timeout: 30000 });
    rmSync(backupPath);
    // Reload profile, clauses, and clients from restored data
    userProfile = loadUserProfile();
    try {
      const dbRaw = readFileSync(join(KNOWLEDGE_DIR, 'clauses-db.json'), 'utf-8');
      clausesDb = JSON.parse(dbRaw);
    } catch {}
    try { clientsDb = loadClients(); } catch {}
    res.json({ success: true, message: 'Backup restored successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI provider status ──────────────────────────────────────────────────────
app.get('/api/claude-code-status', (req, res) => {
  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    const raw = readFileSync(credPath, 'utf-8');
    const data = JSON.parse(raw);
    const oauth = data?.claudeAiOauth;
    res.json({
      available: !!oauth?.accessToken,
      tier: oauth?.subscriptionType || null
    });
  } catch {
    res.json({ available: false, tier: null });
  }
});

app.get('/api/ai-status', async (req, res) => {
  try {
    const config = getProviderConfig();
    if (!config.configured) {
      return res.json({ configured: false, provider: config.provider, model: config.model });
    }
    // Actually test the API connection with a minimal request
    try {
      await chatCompletion({ system: 'Reply with just OK', messages: [{ role: 'user', content: 'test' }], maxTokens: 5 });
      res.json({ configured: true, provider: config.provider, model: config.model, useClaudeOAuth: config.useClaudeOAuth });
    } catch (apiErr) {
      res.json({ configured: true, provider: config.provider, model: config.model, connectionError: apiErr.message });
    }
  } catch (err) {
    res.json({ configured: false, error: err.message });
  }
});

// ─── AI models list ──────────────────────────────────────────────────────────
app.get('/api/ai-models', async (req, res) => {
  try {
    const config = getProviderConfig();
    if (!config.configured) {
      return res.json({ models: [] });
    }

    const headers = { 'anthropic-version': '2023-06-01' };
    if (config.useClaudeOAuth && config.accessToken) {
      headers['Authorization'] = `Bearer ${config.accessToken}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20,claude-code-20250219';
    } else {
      headers['x-api-key'] = config.apiKey;
    }

    const response = await fetch('https://api.anthropic.com/v1/models', { headers });
    if (!response.ok) {
      const body = await response.text();
      console.error('[ai-models] API error:', response.status, body);
      return res.json({ models: [] });
    }

    const data = await response.json();
    const models = (data.data || [])
      .filter(m => /^claude-/.test(m.id))
      .map(m => ({ id: m.id, name: m.display_name || m.id }))
      .sort((a, b) => b.id.localeCompare(a.id));

    res.json({ models });
  } catch (err) {
    console.error('[ai-models] Error:', err.message);
    res.json({ models: [] });
  }
});

// ─── Browser launch helper (pkg-aware) ───────────────────────────────────────

async function launchBrowser() {
  const puppeteer = (await import('puppeteer')).default;
  const opts = { headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  if (IS_PKG) {
    try {
      const { default: chromeFinder } = await import('chrome-finder');
      const cp = chromeFinder();
      if (cp) opts.executablePath = cp;
    } catch { /* use default */ }
  }
  return puppeteer.launch(opts);
}

// ─── Reset flag (for tutorial recording / fresh start) ────────────────────────
if (process.argv.includes('--reset')) {
  console.log('🔄 Resetting all data to fresh state...');
  try {
    rmSync(join(DATA_DIR, 'clients.json'), { force: true });
    rmSync(join(DATA_DIR, 'user-profile.json'), { force: true });
    rmSync(join(PROJECTS_DIR), { recursive: true, force: true });
    mkdirSync(PROJECTS_DIR, { recursive: true });
    writeFileSync(join(PROJECTS_DIR, '_index.json'), JSON.stringify({ projects: [], activeProjectId: null }));
    // Reset clause DB to sample
    const samplePath = join(KNOWLEDGE_DIR, 'clauses-db.sample.json');
    const dbPath = join(KNOWLEDGE_DIR, 'clauses-db.json');
    if (existsSync(samplePath)) { copyFileSync(samplePath, dbPath); }
    // Reload in-memory state
    userProfile = loadUserProfile();
    try { clausesDb = JSON.parse(readFileSync(dbPath, 'utf8')); } catch { clausesDb = { clauses: {} }; }
    console.log('✅ Data reset complete. Starting fresh...\n');
  } catch (err) { console.error('Reset error:', err.message); }
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '127.0.0.1', async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  const aiConfig = getProviderConfig();
  console.log(`AI Provider: ${aiConfig.provider} (${aiConfig.model}) — ${aiConfig.configured ? 'configured' : 'NOT configured'}`);
  if (IS_PKG || process.env.CONTRACTOR_OPEN === '1') {
    setTimeout(() => {
      const url = `http://localhost:${PORT}`;
      if (process.platform === 'win32') {
        exec(`start "" "${url}"`, { shell: true }, (err) => { if (err) console.log('Browser open failed:', err.message); });
      } else {
        import('open').then(m => m.default(url)).catch(() => {});
      }
    }, 800);
  }
  // Version check — no auto-update, just check and report
  setTimeout(async () => {
    try {
      const res = await fetch('https://api.github.com/repos/endlessblink/contractor/releases/latest', { headers: { 'User-Agent': 'contractor' }, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const release = await res.json();
        const latest = release.tag_name?.replace(/^v/, '');
        if (latest && latest !== CURRENT_VERSION) {
          console.log('\n🆕 Update available: v' + CURRENT_VERSION + ' → v' + latest);
          console.log('   Download from: https://github.com/endlessblink/contractor/releases/tag/v' + latest);
          global._updateAvailable = { current: CURRENT_VERSION, latest, url: 'https://github.com/endlessblink/contractor/releases/tag/v' + latest };
        } else {
          console.log('✓ Up to date (v' + CURRENT_VERSION + ')');
        }
      }
    } catch {}
  }, 3000);
});
