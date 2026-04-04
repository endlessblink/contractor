// @ts-check
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Route POST /api/chat to return a fake SSE stream containing a FORM_UPDATE
 * comment block. Call this BEFORE sending a message.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} formUpdateJson  The object that will be JSON-serialised into
 *                                 the <!--FORM_UPDATE:…--> comment.
 */
function mockChatSSE(page, formUpdateJson) {
  return page.route('/api/chat', route => {
    const text = `הנה התיקונים\n\n<!--FORM_UPDATE:${JSON.stringify(formUpdateJson)}-->`;
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

/**
 * Pre-fill the document form by faking a FORM_DATA AI response.
 *
 * The helper:
 *   1. Routes /api/chat to return a FORM_DATA SSE message.
 *   2. Types a message and clicks Send.
 *   3. Waits for the "fill form" button rendered by the AI bubble and clicks it.
 *   4. Un-routes /api/chat so the caller can install a fresh mock for FORM_UPDATE.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} formData  A valid form-data object (same shape the AI produces).
 */
async function prefillForm(page, formData) {
  await page.route('/api/chat', route => {
    const text = `מלא\n\n<!--FORM_DATA:${JSON.stringify(formData)}-->`;
    const body = `data: ${JSON.stringify({ type: 'text', text })}\n\ndata: [DONE]\n\n`;
    route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body,
    });
  });

  await page.fill('#userInput', 'fill');
  await page.click('#sendBtn');
  await page.waitForSelector('.fill-form-btn');
  await page.click('.fill-form-btn');
  // The fill button switches to "create" tab — switch back to chat for the next message
  await page.evaluate(() => { if (typeof switchTab === 'function') switchTab('chat'); });
  await page.locator('#userInput').waitFor({ state: 'visible', timeout: 5000 });
  await page.unroute('/api/chat');
}

/**
 * Send a chat message and wait for the FORM_UPDATE card to appear.
 *
 * @param {import('@playwright/test').Page} page
 */
async function sendMessageAndWaitForCard(page) {
  await page.fill('#userInput', 'עדכן טופס');
  await page.click('#sendBtn');
  await page.waitForSelector('.form-update-card', { timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Shared form-data fixture used by tests that need pre-existing rows
// ---------------------------------------------------------------------------

/** @param {number} rowCount  Number of pricing rows to include. */
function makeFormData(rowCount = 1) {
  const pricingItems = [];
  for (let i = 0; i < rowCount; i++) {
    pricingItems.push({ desc: `פריט ${i + 1}`, qty: 1, price: 100 * (i + 1) });
  }
  return {
    clientName: 'לקוח בדיקה',
    projectDescription: 'פרויקט בדיקה',
    serviceDetails: 'פרטי שירות',
    timeline: 'שבוע',
    notes: 'הערות ראשוניות',
    paymentStructure: 'two',
    pricingItems,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('FORM_UPDATE flow', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
  });

  // ── 1. updateField action ────────────────────────────────────────────────

  test('updateField — applies new value to the target field', async ({ page }) => {
    const formUpdate = {
      actions: [
        { type: 'updateField', field: 'notes', value: 'הערות חדשות' },
      ],
    };

    await mockChatSSE(page, formUpdate);
    await sendMessageAndWaitForCard(page);

    await page.click('.form-update-apply-all');

    // Wait for the button to become disabled (apply complete)
    await page.waitForFunction(() => {
      const btn = document.querySelector('.form-update-apply-all');
      return btn && btn.disabled;
    });

    const value = await page.inputValue('[name="notes"]');
    expect(value).toBe('הערות חדשות');
  });

  // ── 2. addPricingRow action ──────────────────────────────────────────────

  test('addPricingRow — adds a new pricing row after existing one', async ({ page }) => {
    await prefillForm(page, makeFormData(1));

    // Verify we start with exactly 1 row
    const initialRows = await page.locator('#pricingBody tr').count();
    expect(initialRows).toBe(1);

    const formUpdate = {
      actions: [
        { type: 'addPricingRow', desc: 'פריט נוסף', qty: 2, price: 500 },
      ],
    };

    await mockChatSSE(page, formUpdate);
    await sendMessageAndWaitForCard(page);
    await page.click('.form-update-apply-all');

    await page.waitForFunction(() => {
      const btn = document.querySelector('.form-update-apply-all');
      return btn && btn.disabled;
    });

    const rowCount = await page.locator('#pricingBody tr').count();
    expect(rowCount).toBe(2);
  });

  // ── 3. updatePricingRow action ───────────────────────────────────────────

  test('updatePricingRow — updates price on the specified row', async ({ page }) => {
    await prefillForm(page, makeFormData(2));

    const formUpdate = {
      actions: [
        { type: 'updatePricingRow', index: 0, price: 999 },
      ],
    };

    await mockChatSSE(page, formUpdate);
    await sendMessageAndWaitForCard(page);
    await page.click('.form-update-apply-all');

    await page.waitForFunction(() => {
      const btn = document.querySelector('.form-update-apply-all');
      return btn && btn.disabled;
    });

    // First row's price input
    const priceInput = page.locator('#pricingBody tr').first().locator('[data-field="price"]');
    const priceValue = await priceInput.inputValue();
    expect(Number(priceValue)).toBe(999);
  });

  // ── 4. removePricingRow action ───────────────────────────────────────────

  test('removePricingRow — removes the row at the given index', async ({ page }) => {
    await prefillForm(page, makeFormData(2));

    const initialRows = await page.locator('#pricingBody tr').count();
    expect(initialRows).toBe(2);

    const formUpdate = {
      actions: [
        { type: 'removePricingRow', index: 0 },
      ],
    };

    await mockChatSSE(page, formUpdate);
    await sendMessageAndWaitForCard(page);
    await page.click('.form-update-apply-all');

    await page.waitForFunction(() => {
      const btn = document.querySelector('.form-update-apply-all');
      return btn && btn.disabled;
    });

    const rowCount = await page.locator('#pricingBody tr').count();
    expect(rowCount).toBe(1);
  });

  // ── 5. setPayment action ─────────────────────────────────────────────────

  test('setPayment — changes the payment structure select', async ({ page }) => {
    const formUpdate = {
      actions: [
        { type: 'setPayment', structure: 'three' },
      ],
    };

    await mockChatSSE(page, formUpdate);
    await sendMessageAndWaitForCard(page);
    await page.click('.form-update-apply-all');

    await page.waitForFunction(() => {
      const btn = document.querySelector('.form-update-apply-all');
      return btn && btn.disabled;
    });

    const value = await page.locator('#paymentStructure').inputValue();
    expect(value).toBe('three');
  });

  // ── 6. Multiple actions — Apply All ─────────────────────────────────────

  test('Apply All — applies multiple actions together', async ({ page }) => {
    const formUpdate = {
      actions: [
        { type: 'updateField', field: 'notes', value: 'הערה מרובה פעולות' },
        { type: 'addPricingRow', desc: 'שורה חדשה', qty: 3, price: 250 },
        { type: 'setPayment', structure: 'three' },
      ],
    };

    await mockChatSSE(page, formUpdate);
    await sendMessageAndWaitForCard(page);
    await page.click('.form-update-apply-all');

    await page.waitForFunction(() => {
      const btn = document.querySelector('.form-update-apply-all');
      return btn && btn.disabled;
    });

    // All three changes should be visible
    const notesValue = await page.inputValue('[name="notes"]');
    expect(notesValue).toBe('הערה מרובה פעולות');

    // Default form starts with 1 empty row; we added 1 → expect 2
    const rowCount = await page.locator('#pricingBody tr').count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    const paymentValue = await page.locator('#paymentStructure').inputValue();
    expect(paymentValue).toBe('three');
  });

  // ── 7. Individual action apply ───────────────────────────────────────────

  test('individual fu-apply-btn — applies only the clicked action', async ({ page }) => {
    const formUpdate = {
      actions: [
        { type: 'updateField', field: 'notes', value: 'רק הערה' },
        { type: 'setPayment', structure: 'three' },
      ],
    };

    // Read the current payment value before applying anything
    const originalPayment = await page.locator('#paymentStructure').inputValue();

    await mockChatSSE(page, formUpdate);
    await sendMessageAndWaitForCard(page);

    // Click only the FIRST individual apply button (index 0 → updateField)
    const applyBtns = page.locator('.fu-apply-btn');
    await applyBtns.first().click();

    // Wait for that button to be marked done
    await page.waitForFunction(() => {
      const btns = document.querySelectorAll('.fu-apply-btn');
      return btns[0] && btns[0].disabled;
    });

    // First action's change must be applied
    const notesValue = await page.inputValue('[name="notes"]');
    expect(notesValue).toBe('רק הערה');

    // Second action (setPayment) must NOT have been applied
    const paymentValue = await page.locator('#paymentStructure').inputValue();
    expect(paymentValue).toBe(originalPayment);
  });
});
