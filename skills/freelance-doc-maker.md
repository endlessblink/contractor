# Skill: Freelance Document Maker (Hebrew)

**Trigger:** Creating quotes (הצעת מחיר), contracts (חוזה), or work orders (הזמנת עבודה) for Noam Naumovsky's freelance business.

**Purpose:** Generate professional Hebrew RTL business documents as DOCX files with consistent branding, structure, and legal terms.

---

## Identity

- **Name:** נועם נאומובסקי (Noam Naumovsky)
- **Company:** Noam Naumovsky Productions
- **Title:** במאי, עורך, אנימטור
- **Email:** noamnau@gmail.com
- **Website:** noamn.com
- **Phone:** 052-6784960
- **Logo:** Blue-to-teal tech gradient (assets/logo.png)

---

## Document Types

### 1. הצעת מחיר (Quote / Proposal)

Used for: Initial pricing proposals, service offerings, workshop pricing.

Structure:
1. Title: "הצעת מחיר" (centered, 22pt bold)
2. Subtitle: project description (centered, 13pt, gray)
3. From/To table (מאת / לכבוד) with light blue background
4. Date
5. **פירוט השירות** — What's included
6. **עלות** — Pricing table with itemized costs
7. **תמורה ותנאי תשלום** — Payment terms
8. **לוחות זמנים** — Timeline and deliverables
9. **הערות כלליות** — General notes (validity period, etc.)
10. Footer with logo + contact info

### 2. הזמנת עבודה / חוזה (Work Order / Contract)

Used for: Formal agreements after quote acceptance.

Additional sections beyond quote:
- **תיקונים והערות** — Revision policy (rounds, hourly rate beyond)
- **נקודות יציאה** — Exit points for both parties
- **קניין רוחני, רישוי ואחריות** — IP, licensing, liability
- **הגדרת "סיום" ותקופת אחריות** — Definition of "done" + grace period
- **תנאים כלליים** — Cancellation, force majeure, liability limits
- **Signature area** — הלקוח (right) / הספק (left)

---

## Design System

### Typography
| Element | Font | Size | Weight |
|---|---|---|---|
| Document title | Heebo | 22pt | Bold |
| Subtitle | Heebo | 13pt | Regular, gray (#555555) |
| Section headers | Heebo | 16pt | Bold |
| Body text | Heebo | 11pt | Regular |
| Footer | Heebo | 9pt | Regular |

### Colors
| Usage | Hex |
|---|---|
| Section header background | #D6E4F0 (light blue) |
| Table header background | #D6E4F0 |
| Table borders | #BFBFBF (light gray) |
| Subtitle text | #555555 |

### Layout
- Page margins: 0.8" top, 1" bottom, 0.9" sides
- Paragraph spacing: 120 twips after
- Section header spacing: 300 before, 200 after
- Bullet spacing: 80 twips after

### Footer (every page)
- Thin gray line separator above
- RTL table: Logo on right, contact on left
- Logo: 60×60px
- Contact: name+title, email|website, phone

---

## Payment Patterns

Based on established business patterns:

### Standard (short projects, single deliverable)
- 35% advance upon signing (מקדמה)
- 65% upon completion

### Long Projects (5+ deliverables, multi-week)
- 40% advance (מקדמה)
- 30% at midpoint milestone
- 30% upon completion

### Hourly Rate
- Standard: 185 ₪ + מע"מ per hour
- Used for: extra revisions, scope changes, additional documentation

### Revision Policy
- 2 rounds included per deliverable (standard)
- "Round" = consolidated feedback sent together (not drip)
- Beyond included rounds → hourly rate
- Major direction change = new work, not a revision
- Technical fixes (typos, minor cuts) don't count as a round

---

## Standard Legal Terms

### תמורה ותנאי תשלום (Payment Terms)
- Work starts upon receiving advance + signed agreement
- Project costs do not include API/external service costs (paid by client)
- Full payment triggers tax invoice (חשבונית מס)
- Prices exclude מע"מ

### לוחות זמנים (Timeline)
- Client provides materials, access, and content before/during work
- Delay in materials → delay in delivery
- Kickoff meeting before start, follow-ups as needed
- Client must be available for technical questions

### נקודות יציאה (Exit Points)
- Either party can exit after first deliverable
- Either party can exit at natural milestone (e.g., after phase 1)
- Exit = pay for work completed to date

### קניין רוחני (IP)
- Upon full payment: client owns final deliverables (files, videos, etc.)
- Provider retains IP in techniques, methods, and professional know-how
- Provider may reuse techniques for other clients

### הערות כלליות (General)
- Quote valid for 30 days
- Final engagement requires signed detailed agreement
- AI-generated content disclaimer: results may vary, client reviews before publication
- Service based on advanced AI tools; capabilities depend on tool limitations
- Cancellation: either party, 7 days written notice
- Liability limited to amount actually paid
- Force majeure clause

---

## Tech Stack

- **Generator:** Node.js ES modules + `docx` npm package (v9+)
- **PDF:** Puppeteer (HTML → PDF with Chromium for perfect Hebrew bidi)
- **Fonts:** Heebo (bundled in assets/fonts/)
- **RTL:** See `rtl-hebrew-docx` skill for mandatory rules

### Generate a document:
```bash
node src/generate-quote.mjs
```

---

## Checklist Before Delivery

- [ ] All text is RTL (open in Word to verify)
- [ ] Tables have correct column order (RTL)
- [ ] Section headers have light blue background
- [ ] Logo appears in footer on every page
- [ ] Prices are correct and add up
- [ ] Payment percentages match total
- [ ] Client name and company are correct
- [ ] Date is current
- [ ] מע"מ exclusion is stated
- [ ] Quote validity period is specified
