/**
 * HTML Preview Renderer
 *
 * Takes the same form data as generate-quote.mjs but outputs an HTML string
 * instead of DOCX nodes. Isomorphic: works in both Node.js and browser.
 */

import { processDocData } from './shared/doc-skills/index.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a number as Hebrew price string */
function formatPrice(n) {
  return (typeof n === 'number' ? n : 0).toLocaleString('he-IL') + ' ₪';
}

/** Escape HTML special characters */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split('\n').map(v => v.trim()).filter(Boolean);
  return [];
}

function buildCvFallbackSections(data) {
  const sections = [];
  const timeline = normalizeArray(data.timeline);
  const notes = normalizeArray(data.notes);

  if (timeline.length > 0) sections.push({ title: 'ניסיון / ציר זמן', items: timeline });
  if (notes.length > 0) sections.push({ title: 'מידע נוסף', items: notes });

  return sections;
}

/** Build a clause-text getter, mirroring getClauseTexts from generate-quote.mjs */
function makeClauseGetter({ clausesDb, documentType, selectedClauses, clauseEdits, relevantClauseIds, language }) {
  return function getClauseTexts(categoryKey) {
    if (!clausesDb || !clausesDb.clauses || !clausesDb.clauses[categoryKey]) return [];
    const docTypeKey = documentType === 'quote' ? 'quote' : documentType === 'contract' ? 'contract' : documentType === 'cv' ? 'cv' : 'workOrder';
    return clausesDb.clauses[categoryKey].clauses
      .filter(c => {
        if (!c.appliesTo.includes(docTypeKey)) return false;
        if (selectedClauses && Array.isArray(selectedClauses) && selectedClauses.length > 0) {
          return selectedClauses.includes(c.id);
        }
        if (relevantClauseIds) {
          return relevantClauseIds.has(c.id) || c.required;
        }
        return true;
      })
      .map(c => {
        const text = (clauseEdits && clauseEdits[c.id]) || c.text;
        return typeof text === 'object' ? (text[language] || text.he || text.en || '') : text;
      });
  };
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const PREVIEW_CSS = `
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
  const fullName = cv.fullName || data.clientName || data.userProfile?.nameEn || data.userProfile?.name || 'קורות חיים';
  const headline = cv.headline || data.projectDescription || data.userProfile?.title || '';
  const location = cv.location || '';
  const profile = cv.profile || data.serviceDetails || '';
  const phone = cv.phone || data.userProfile?.phone || '';
  const email = cv.email || data.userProfile?.email || '';
  const website = cv.website || data.userProfile?.website || '';
  const links = Array.isArray(cv.links) ? cv.links : [];
  const sections = normalizeArray(cv.sections);
  const fallbackSections = sections.length > 0 ? [] : buildCvFallbackSections(data);
  const contactParts = [phone, email, website, ...links.map(link => link.url ? `${link.label || ''}: ${link.url}`.trim() : link.label).filter(Boolean)];
  const parts = [PREVIEW_CSS, '<div class="doc-preview" dir="rtl">'];

  parts.push('<header class="cv-header">');
  parts.push(`<h1 class="cv-name">${esc(fullName)}</h1>`);
  if (headline || location) parts.push(`<p class="cv-headline">${esc([headline, location].filter(Boolean).join(' · '))}</p>`);
  if (contactParts.length > 0) parts.push(`<p class="cv-contact">${contactParts.map(esc).join(' · ')}</p>`);
  parts.push('</header>');

  if (profile) {
    parts.push('<section>');
    parts.push('<h2 class="cv-section-title">פרופיל</h2>');
    parts.push(`<p class="doc-paragraph">${esc(profile)}</p>`);
    parts.push('</section>');
  }

  for (const section of [...sections, ...fallbackSections]) {
    if (!section || !section.title) continue;
    parts.push('<section>');
    parts.push(`<h2 class="cv-section-title">${esc(section.title)}</h2>`);
    for (const item of normalizeArray(section.items)) {
      if (typeof item === 'string') {
        parts.push(`<ul class="cv-list"><li>${esc(item)}</li></ul>`);
        continue;
      }
      const role = [item.title, item.organization].filter(Boolean).join(' — ');
      const roleLine = item.dates || item.date ? `${role}   ${item.dates || item.date}` : role;
      if (roleLine) parts.push(`<p class="cv-role">${esc(roleLine)}</p>`);
      const bullets = normalizeArray(item.bullets || item.details || item.description);
      if (bullets.length > 0) {
        parts.push('<ul class="cv-list">');
        bullets.forEach(bullet => parts.push(`<li>${esc(bullet)}</li>`));
        parts.push('</ul>');
      }
    }
    parts.push('</section>');
  }

  const skills = normalizeArray(cv.skills);
  if (skills.length > 0) {
    parts.push('<section><h2 class="cv-section-title">כישורים וכלים</h2><ul class="cv-list">');
    for (const skillGroup of skills) {
      if (typeof skillGroup === 'string') {
        parts.push(`<li>${esc(skillGroup)}</li>`);
      } else {
        const items = normalizeArray(skillGroup.items).join(', ');
        const line = [skillGroup.category, items].filter(Boolean).join(' — ');
        if (line) parts.push(`<li>${esc(line)}</li>`);
      }
    }
    parts.push('</ul></section>');
  }

  const languages = normalizeArray(cv.languages);
  if (languages.length > 0) {
    parts.push('<section><h2 class="cv-section-title">שפות</h2><ul class="cv-list">');
    languages.forEach(language => parts.push(`<li>${esc(language)}</li>`));
    parts.push('</ul></section>');
  }

  parts.push('</div>');
  return parts.join('\n');
}

// ─── Main Renderer ───────────────────────────────────────────────────────────

/**
 * Render document data as an HTML preview string.
 *
 * @param {Object} data - Same shape as generateDocument() receives
 * @param {Object} [options] - Optional overrides
 * @param {Object} [options.clausesDb] - Pre-loaded clauses DB (browser passes this; Node loads from disk)
 * @returns {string} Complete HTML string for preview
 */
export function renderPreviewHTML(data, options = {}) {
  // Attach clauses DB so the dedupe-notes skill can reconcile notes against
  // clauses (same as generateDocument), keeping preview consistent with output.
  if (options.clausesDb) data._clausesDb = options.clausesDb;

  // Run doc-skills pipeline (mutates data in-place)
  processDocData(data);

  const {
    clientName = '',
    clientCompany = '',
    documentType = 'quote',
    projectDescription = '',
    serviceDetails = '',
    pricingItems = [],
    paymentTerms = { type: 'two', installments: [] },
    timeline = '',
    generalNotes = '',
    date = null,
    serviceType = '',
    selectedClauses = null,
    clauseEdits = {},
    userProfile = {},
  } = data;

  const language = userProfile.language || 'he';

  if (documentType === 'cv') {
    return renderCvPreviewHTML(data);
  }

  // Resolve clauses DB (must be passed by caller — keeps module isomorphic)
  const clausesDb = options.clausesDb || null;

  // Service template → relevant clause IDs
  let relevantClauseIds = null;
  if (serviceType && clausesDb && clausesDb.serviceTemplates) {
    const template = clausesDb.serviceTemplates.find(t => t.type === serviceType);
    if (template && template.relevantClauses) {
      relevantClauseIds = new Set(template.relevantClauses);
    }
  }

  const getClauseTexts = makeClauseGetter({ clausesDb, documentType, selectedClauses, clauseEdits, relevantClauseIds, language });

  // ── Date ──
  const today = date || new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });

  // ── Title ──
  const titleMap = { quote: 'הצעת מחיר', contract: 'חוזה עבודה', workOrder: 'הזמנת עבודה', cv: 'קורות חיים' };
  const docTitle = titleMap[documentType] || 'הצעת מחיר';

  // ── Price helpers ──
  const hasOptions = pricingItems.some(item => item.option != null && String(item.option).trim() !== '');

  let sharedItems = [];
  let optionGroups = {};
  if (hasOptions) {
    for (const item of pricingItems) {
      const opt = item.option != null ? String(item.option).trim() : '';
      if (opt === '') {
        sharedItems.push(item);
      } else {
        if (!optionGroups[opt]) optionGroups[opt] = [];
        optionGroups[opt].push(item);
      }
    }
  }

  const totalBeforeVat = hasOptions
    ? 0
    : pricingItems.reduce((sum, item) => sum + (item.quantity || 1) * (item.unitPrice || 0), 0);

  // ── Build HTML ──
  const parts = [];
  parts.push(PREVIEW_CSS);
  parts.push('<div class="doc-preview" dir="rtl">');

  // Date
  parts.push(`<p class="doc-date">תאריך ${esc(today)}</p>`);

  // Title
  parts.push(`<h1 class="doc-title">${esc(docTitle)} &ndash;</h1>`);

  // Subtitle
  if (projectDescription) {
    parts.push(`<p class="doc-subtitle">${esc(projectDescription)}</p>`);
  }

  // From/To table
  parts.push('<table class="doc-from-to">');
  parts.push('<tr>');
  parts.push(`<td><strong>מאת:</strong> ${esc(userProfile.nameEn || userProfile.name || '')}</td>`);
  parts.push(`<td><strong>לכבוד:</strong> ${esc(clientName)}</td>`);
  parts.push('</tr>');
  parts.push('<tr>');
  parts.push(`<td>${esc(userProfile.company || '')}</td>`);
  parts.push(`<td>${esc(clientCompany || '')}</td>`);
  parts.push('</tr>');
  parts.push('</table>');

  // Service details
  if (serviceDetails) {
    parts.push('<div class="doc-section">');
    parts.push('<h2 class="doc-section-header">פירוט השירות</h2>');

    const lines = serviceDetails.split('\n').filter(l => l.trim());
    const sdOptions = [];
    const plainLines = [];
    let currentOpt = null;

    for (const line of lines) {
      const optMatch = line.match(/^אופציה\s*(\d+)\s*[–—\-:]\s*(.*)/);
      if (optMatch) {
        let title = optMatch[2].trim().replace(/^אופציה\s*\d+\s*[–—\-:]\s*/, '').trim();
        const titleSentences = title.split(/(?<=\.)\s+/).filter(s => s.trim());
        const mainTitle = titleSentences[0] || title;
        const extraDetails = titleSentences.slice(1);
        currentOpt = { label: `אופציה ${optMatch[1]}`, title: mainTitle, details: [...extraDetails] };
        sdOptions.push(currentOpt);
      } else if (currentOpt) {
        const cleaned = line.replace(/^[•\-]\s*/, '');
        const sentences = cleaned.split(/(?<=\.)\s+/).filter(s => s.trim());
        if (sentences.length > 1) {
          sentences.forEach(s => currentOpt.details.push(s.trim()));
        } else {
          currentOpt.details.push(cleaned);
        }
      } else {
        plainLines.push(line);
      }
    }

    // Plain lines
    for (const line of plainLines) {
      if (sdOptions.length > 0 && /אופציו?ת.*לבחירה|יש לבחור/i.test(line)) continue;
      if (line.startsWith('•') || line.startsWith('-')) {
        parts.push(`<ul class="doc-dash-list"><li>${esc(line.replace(/^[•\-]\s*/, ''))}</li></ul>`);
      } else {
        parts.push(`<p class="doc-paragraph">${esc(line)}</p>`);
      }
    }

    // Options table
    if (sdOptions.length > 0) {
      parts.push('<table class="doc-options-table">');
      parts.push('<thead><tr><th style="width:20%">אופציה</th><th style="width:80%">פירוט</th></tr></thead>');
      parts.push('<tbody>');
      for (const opt of sdOptions) {
        const detailHtml = (opt.title ? `<strong>${esc(opt.title)}</strong><br>` : '')
          + opt.details.map(d => `<span>&#8226; ${esc(d)}</span>`).join('<br>');
        parts.push(`<tr><td><strong>${esc(opt.label)}</strong></td><td>${detailHtml}</td></tr>`);
      }
      parts.push('</tbody></table>');
    }

    parts.push('</div>');
  }

  // Pricing section
  if (pricingItems.length > 0) {
    parts.push('<div class="doc-section">');
    parts.push('<h2 class="doc-section-header">עלות</h2>');

    if (hasOptions) {
      // Shared items
      if (sharedItems.length > 0) {
        parts.push(buildPricingTableHTML(sharedItems));
      }

      // Per-option tables
      for (const [optKey, optItems] of Object.entries(optionGroups)) {
        const firstDesc = optItems[0] && optItems[0].description ? optItems[0].description : '';
        const optionLabel = firstDesc ? `אופציה ${optKey} — ${firstDesc}` : `אופציה ${optKey}`;
        parts.push(`<p class="doc-option-label">${esc(optionLabel)}</p>`);
        const tableItems = [...sharedItems, ...optItems];
        parts.push(buildPricingTableHTML(tableItems));
      }
    } else {
      parts.push(buildPricingTableHTML(pricingItems));
    }

    parts.push('</div>');
  }

  // Payment terms
  if (paymentTerms && paymentTerms.installments && paymentTerms.installments.length > 0) {
    parts.push('<div class="doc-section">');
    parts.push('<h2 class="doc-section-header">תמורה ותנאי תשלום</h2>');

    const paymentTotals = [];
    if (hasOptions) {
      for (const [optKey, optItems] of Object.entries(optionGroups)) {
        const shared = sharedItems.reduce((s, i) => s + (i.quantity || 1) * (i.unitPrice || 0), 0);
        const optTotal = optItems.reduce((s, i) => s + (i.quantity || 1) * (i.unitPrice || 0), 0) + shared;
        paymentTotals.push({ label: `אופציה ${optKey}`, total: optTotal });
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
        const amountStr = amount > 0 ? ` בסך של ${formatPrice(amount)} + מע"מ` : '';
        const text = `${inst.description} – ${pct}%${amountStr}`;
        parts.push(`<td>&#8226; ${esc(text)}</td>`);
      }
      parts.push('</tr></table>');
    }

    // Payment clauses for any doc type (filtered by appliesTo). Notes are
    // reconciled against clauses upstream, so no per-clause dedup hack here.
    if (clausesDb) {
      const paymentClauses = getClauseTexts('paymentTerms');
      if (paymentClauses.length > 0) {
        parts.push('<ul class="doc-dash-list">');
        paymentClauses.forEach(text => parts.push(`<li>${esc(text)}</li>`));
        parts.push('</ul>');
      }
    }

    const invoiceClauseSelected = selectedClauses && selectedClauses.includes('payment-invoice');
    if (!invoiceClauseSelected) {
      parts.push('<ul class="doc-dash-list"><li>לאחר קבלת התשלום המלא תישלח חשבונית מס.</li></ul>');
    }

    parts.push('</div>');
  }

  // Timeline
  if (timeline) {
    parts.push('<div class="doc-section">');
    parts.push('<h2 class="doc-section-header">לוחות זמנים</h2>');
    parts.push('<ul class="doc-dash-list">');
    const timelineLines = timeline.split('\n').filter(l => l.trim());
    for (const line of timelineLines) {
      parts.push(`<li>${esc(line.replace(/^[•\-]\s*/, ''))}</li>`);
    }
    parts.push('</ul></div>');
  }

  // Legal / terms clause sections — each renders iff its category yields
  // clauses for the current doc type (getClauseTexts filters by appliesTo).
  const clauseSections = [
    { key: 'clientObligations', title: 'התחייבויות הלקוח', style: 'dash' },
    { key: 'earlyTermination', title: 'הפסקת עבודה מוקדמת', style: 'dash' },
    { key: 'revisions', title: 'תיקונים והערות', style: 'dash' },
    { key: 'deliveryProcess', title: 'תהליך סיום ומסירה', style: 'dash' },
    { key: 'intellectualProperty', title: 'קניין רוחני, רישוי ואחריות', style: 'paragraph' },
    { key: 'aiDisclaimers', title: 'הצהרות לקוח (AI גנרטיבי)', style: 'paragraph' },
    { key: 'warrantyAndCompletion', title: 'הגדרת "סיום" ותקופת אחריות', style: 'paragraph' },
    { key: 'commercialResponsibility', title: 'אחריות לשימוש מסחרי', style: 'paragraph' },
    { key: 'confidentiality', title: 'סודיות', style: 'paragraph' },
    { key: 'projectTermination', title: 'סיום הפרויקט', style: 'dash' },
    { key: 'generalTerms', title: 'תנאים כלליים', style: 'paragraph' },
  ];

  for (const section of clauseSections) {
    const clauseTexts = getClauseTexts(section.key);
    if (clauseTexts.length > 0) {
      parts.push('<div class="doc-section">');
      parts.push(`<h2 class="doc-section-header">${esc(section.title)}</h2>`);
      if (section.style === 'dash') {
        parts.push('<ul class="doc-dash-list">');
        clauseTexts.forEach(text => parts.push(`<li>${esc(text)}</li>`));
        parts.push('</ul>');
      } else {
        clauseTexts.forEach(text => parts.push(`<p class="doc-paragraph">${esc(text)}</p>`));
      }
      parts.push('</div>');
    }
  }

  // General notes (project-specific remarks only — skip header if empty)
  if (generalNotes) {
    let noteLines = generalNotes.split('\n').filter(l => l.trim());
    if (noteLines.length === 1 && noteLines[0].includes('. ')) {
      noteLines = noteLines[0].split(/\.\s+/).filter(l => l.trim()).map(l => l.endsWith('.') ? l : l + '.');
    }
    if (noteLines.length > 0) {
      parts.push('<div class="doc-section">');
      parts.push('<h2 class="doc-section-header">הערות כלליות</h2>');
      parts.push('<ul class="doc-dash-list">');
      for (const line of noteLines) {
        parts.push(`<li>${esc(line.replace(/^[•\-]\s*/, ''))}</li>`);
      }
      parts.push('</ul></div>');
    }
  }

  // Signature (contracts/work orders only)
  const showSignature = data._sectionFlags?.showSignature !== false
    ? (documentType === 'contract' || documentType === 'workOrder')
    : data._sectionFlags.showSignature;

  if (showSignature) {
    parts.push('<div class="doc-signature">');
    const signatureBindingInTerms = selectedClauses && selectedClauses.includes('general-signature-binding');
    if (!signatureBindingInTerms) {
      parts.push('<p class="doc-signature-title">חתימה על מסמך זה מהווה אישור והתחייבות לכל הרשום לעיל</p>');
    }
    parts.push('<table class="doc-sig-table">');
    parts.push('<tr>');
    parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">שם הלקוח</div></td>');
    parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">חתימה וחותמת</div></td>');
    parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">תאריך</div></td>');
    parts.push('</tr>');
    parts.push('<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>');
    parts.push('<tr>');
    parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">שם מבצע העבודה</div></td>');
    parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">חתימה וחותמת</div></td>');
    parts.push('<td><div class="doc-sig-line"></div><div class="doc-sig-label">תאריך</div></td>');
    parts.push('</tr>');
    parts.push('</table></div>');
  }

  // Footer
  parts.push('<div class="doc-footer">');
  parts.push('<div class="doc-footer-info">');
  if (userProfile.name) {
    parts.push(`<p class="footer-name">${esc(userProfile.name)}</p>`);
  }
  if (userProfile.title) {
    parts.push(`<p>${esc(userProfile.title)}</p>`);
  }
  const contactLine = [userProfile.email, userProfile.website].filter(Boolean).join(' | ');
  if (contactLine) {
    parts.push(`<p>${esc(contactLine)}</p>`);
  }
  if (userProfile.phone) {
    parts.push(`<p>${esc(userProfile.phone)}</p>`);
  }
  parts.push('</div></div>');

  parts.push('</div>'); // close .doc-preview

  return parts.join('\n');
}

// ─── Pricing Table Builder ───────────────────────────────────────────────────

function buildPricingTableHTML(items) {
  const subtotal = items.reduce((sum, item) => sum + (item.quantity || 1) * (item.unitPrice || 0), 0);
  const rows = items.map(item => {
    const total = (item.quantity || 1) * (item.unitPrice || 0);
    return `<tr>
      <td>${esc(item.description || '')}</td>
      <td>${item.quantity || 1}</td>
      <td>${formatPrice(item.unitPrice || 0)}</td>
      <td>${formatPrice(total)}</td>
    </tr>`;
  }).join('\n');

  return `<table class="doc-pricing-table">
<thead><tr><th style="width:45%">פירוט</th><th style="width:15%">כמות</th><th style="width:20%">מחיר ליחידה</th><th style="width:20%">סה"כ</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td></td><td></td><td>סה"כ לפני מע"מ</td><td>${formatPrice(subtotal)}</td></tr></tfoot>
</table>`;
}
