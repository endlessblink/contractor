import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper: mock POST /api/chat to return a controlled SSE stream that embeds
// a <!--FORM_DATA:{...}--> comment in the assistant reply.
// ---------------------------------------------------------------------------
function mockChatSSE(page, formDataJson) {
  return page.route('/api/chat', route => {
    const commentPayload = JSON.stringify(formDataJson);
    const text = `הנה ההצעה שלך\n\n<!--FORM_DATA:${commentPayload}-->`;
    const chunks = [
      `data: ${JSON.stringify({ type: 'text', text })}\n\n`,
      `data: [DONE]\n\n`,
    ];
    route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: chunks.join(''),
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: mock common page-load API calls so the page renders cleanly without
// a real server back-end.
// ---------------------------------------------------------------------------
async function mockCommonRoutes(page) {
  // Setup status — mark setup as complete so onboarding overlay does not fire
  await page.route('/api/setup-status', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupComplete: true, hasProfile: true, version: '0.0.0' }),
    })
  );

  // User profile
  await page.route('/api/user-profile', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupComplete: true, hasProfile: true }),
    })
  );

  // Document types — minimal list; must exist or the docType select will be empty
  await page.route('/api/document-types', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { id: 'quote',    label: 'הצעת מחיר' },
        { id: 'contract', label: 'חוזה' },
      ]),
    })
  );

  // Clauses DB
  await page.route('/api/clauses-db', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: {}, clauses: [] }),
    })
  );

  // Recommend clauses (may fire after prefill)
  await page.route('/api/recommend-clauses', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommended: [] }),
    })
  );

  // Documents + references lists (used by the docs panel)
  await page.route('/api/documents', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    })
  );

  await page.route('/api/reference-documents', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    })
  );

  // Projects list (needed when navigating to view=document)
  await page.route('/api/projects', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    })
  );

  // Clients list
  await page.route('/api/clients', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    })
  );
}

// ---------------------------------------------------------------------------
// Helper: load the app and navigate to the document workspace view (the one
// that contains the chat and create panels), then wait until the JS is ready.
// ---------------------------------------------------------------------------
async function loadApp(page) {
  await mockCommonRoutes(page);
  await page.goto('/');

  // Wait for the app JS to finish bootstrapping — the _navigate function is
  // registered near the end of the inline script block.
  await page.waitForFunction(() => typeof window._navigate === 'function', { timeout: 15000 });

  // Navigate to the document workspace so the chat + create panels are visible
  await page.evaluate(() => window._navigate('document'));

  // view-document should now be active; wait for sendBtn to be visible
  await page.locator('#sendBtn').waitFor({ state: 'visible', timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Helper: type a message and submit, then wait for the fill-form button.
// ---------------------------------------------------------------------------
async function sendChatMessage(page, message = 'צור הצעת מחיר') {
  const input = page.locator('#userInput');
  await input.fill(message);
  await page.locator('#sendBtn').click();
  // The assistant reply containing FORM_DATA renders a "מלא טופס" button
  await page.locator('.fill-form-btn').first().waitFor({ state: 'visible', timeout: 10000 });
}

// ===========================================================================
// TESTS
// ===========================================================================

test.describe('FORM_DATA fills form from chat', () => {

  // -------------------------------------------------------------------------
  // 1. All basic fields are filled
  // -------------------------------------------------------------------------
  test('FORM_DATA fills all basic fields', async ({ page }) => {
    const formData = {
      clientName: 'דנה לוי',
      clientCompany: 'חברת לוי בע"מ',
      docType: 'quote',
      projectDescription: 'פיתוח אתר תדמית',
      serviceDetails: 'עיצוב, פיתוח, תוכן',
      timeline: '6 שבועות',
      notes: 'כולל 2 סבבי תיקונים',
      documentDate: '2026-04-15',
    };

    await mockChatSSE(page, formData);
    await loadApp(page);
    await sendChatMessage(page);

    // Click "מלא טופס"
    await page.locator('.fill-form-btn').first().click();

    // In the three-panel desktop layout both panels are always visible via
    // display:flex !important — no active-class gating needed.  We simply
    // wait for the first filled field to prove prefillForm() ran.

    // Verify each field
    await expect(page.locator('[name="clientName"]')).toHaveValue(formData.clientName);
    await expect(page.locator('[name="clientCompany"]')).toHaveValue(formData.clientCompany);
    await expect(page.locator('[name="docType"]')).toHaveValue(formData.docType);
    await expect(page.locator('[name="projectDescription"]')).toHaveValue(formData.projectDescription);
    await expect(page.locator('[name="serviceDetails"]')).toHaveValue(formData.serviceDetails);
    await expect(page.locator('[name="timeline"]')).toHaveValue(formData.timeline);
    await expect(page.locator('[name="notes"]')).toHaveValue(formData.notes);
    await expect(page.locator('#documentDate')).toHaveValue(formData.documentDate);
  });

  // -------------------------------------------------------------------------
  // 2. Pricing rows are populated
  // -------------------------------------------------------------------------
  test('FORM_DATA fills pricing rows', async ({ page }) => {
    const formData = {
      clientName: 'יוסי כהן',
      pricingItems: [
        { desc: 'עיצוב לוגו',         qty: 1, price: 1500 },
        { desc: 'בניית אתר וורדפרס', qty: 1, price: 4800 },
      ],
    };

    await mockChatSSE(page, formData);
    await loadApp(page);
    await sendChatMessage(page);
    await page.locator('.fill-form-btn').first().click();

    // Two pricing rows should exist
    const rows = page.locator('#pricingBody tr');
    await expect(rows).toHaveCount(2, { timeout: 5000 });

    // First row
    await expect(rows.nth(0).locator('[data-field="desc"]')).toHaveValue('עיצוב לוגו');
    await expect(rows.nth(0).locator('[data-field="qty"]')).toHaveValue('1');
    await expect(rows.nth(0).locator('[data-field="price"]')).toHaveValue('1500');

    // Second row
    await expect(rows.nth(1).locator('[data-field="desc"]')).toHaveValue('בניית אתר וורדפרס');
    await expect(rows.nth(1).locator('[data-field="qty"]')).toHaveValue('1');
    await expect(rows.nth(1).locator('[data-field="price"]')).toHaveValue('4800');
  });

  // -------------------------------------------------------------------------
  // 3. Custom payment structure
  // -------------------------------------------------------------------------
  test('FORM_DATA fills payment structure with custom installments', async ({ page }) => {
    const formData = {
      clientName: 'רוני שמש',
      paymentStructure: 'custom',
      customInstallments: [40, 30, 30],
      pricingItems: [
        { desc: 'ייעוץ אסטרטגי', qty: 10, price: 500 },
      ],
    };

    await mockChatSSE(page, formData);
    await loadApp(page);
    await sendChatMessage(page);
    await page.locator('.fill-form-btn').first().click();

    // Payment select should show "custom"
    await expect(page.locator('#paymentStructure')).toHaveValue('custom');

    // Each custom installment input should reflect the provided percentages
    await expect(page.locator('#custom1')).toHaveValue('40');
    await expect(page.locator('#custom2')).toHaveValue('30');
    await expect(page.locator('#custom3')).toHaveValue('30');
  });

  // -------------------------------------------------------------------------
  // 4. Partial FORM_DATA — missing optional fields must not crash
  // -------------------------------------------------------------------------
  test('FORM_DATA with only clientName and pricingItems fills without crashing', async ({ page }) => {
    const formData = {
      clientName: 'מיכל בן-דוד',
      pricingItems: [
        { desc: 'צילום מוצרים', qty: 5, price: 300 },
      ],
    };

    await mockChatSSE(page, formData);
    await loadApp(page);
    await sendChatMessage(page);

    // Should not throw — the fill button must be clickable
    await page.locator('.fill-form-btn').first().click();

    // Provided fields are populated
    await expect(page.locator('[name="clientName"]')).toHaveValue(formData.clientName);

    const rows = page.locator('#pricingBody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('[data-field="desc"]')).toHaveValue('צילום מוצרים');
    await expect(rows.first().locator('[data-field="price"]')).toHaveValue('300');

    // Unprovided optional fields remain empty
    await expect(page.locator('[name="clientCompany"]')).toHaveValue('');
    await expect(page.locator('[name="projectDescription"]')).toHaveValue('');
  });

});
