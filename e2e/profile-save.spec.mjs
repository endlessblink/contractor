import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:6831';

test('Settings → Profile save shows confirmation and persists', async ({ page, request }) => {
  // Snapshot original profile to restore afterward
  const original = await (await request.get(`${BASE}/api/user-profile`)).json();

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE);
  await page.evaluate(() => window.openSettings());
  await page.waitForSelector('#settingsOverlay', { state: 'visible' });

  const testName = 'QA Test ' + original.name;
  await page.fill('#profileName', testName);
  await page.click('#profileSaveBtn');

  // Success indicator appears
  await expect(page.locator('#profileSaveStatus')).toContainText('נשמר', { timeout: 4000 });

  // Persisted to disk / returned by API
  const saved = await (await request.get(`${BASE}/api/user-profile`)).json();
  expect(saved.name).toBe(testName);

  // No uncaught JS errors during the flow
  expect(errors).toEqual([]);

  // Restore original profile
  await request.put(`${BASE}/api/user-profile`, { data: { name: original.name } });
});
