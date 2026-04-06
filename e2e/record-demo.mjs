#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import { mkdirSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, '..');

// Find binary
const updaterSrc = readFileSync(join(projectDir, 'src/updater.mjs'), 'utf-8');
const version = updaterSrc.match(/CURRENT_VERSION\s*=\s*'([^']+)'/)?.[1] || 'unknown';
const binaryPath = join(projectDir, 'dist/executables', `contractor-linux-x64-v${version}`);

const PORT = 16833;
const testDataDir = join('/tmp', 'contractor-demo-' + Date.now());
let serverProcess;

async function main() {
  console.log('Recording demo...');
  console.log('Binary:', binaryPath);

  // Start clean server
  mkdirSync(testDataDir, { recursive: true });
  serverProcess = spawn(binaryPath, [], {
    env: { ...process.env, PORT: String(PORT), CONTRACTOR_DATA_DIR: testDataDir, ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

  serverProcess.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`\nServer exited unexpectedly with code ${code}`);
    }
  });

  // Wait for server (up to 20 seconds)
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.status === 200) { ready = true; break; }
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }

  if (!ready) {
    throw new Error('Server did not start within 20 seconds');
  }

  console.log('Server ready. Setting up demo data...');

  // Set up demo profile
  await fetch(`http://127.0.0.1:${PORT}/api/user-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'סטודיו דוגמה',
      company: 'סטודיו דוגמה בע"מ',
      title: 'מעצב ומפתח',
      setupComplete: true,
    }),
  });

  await fetch(`http://127.0.0.1:${PORT}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'אתר לדוגמה' }),
  });

  // Ensure docs dir exists
  mkdirSync(join(projectDir, 'docs'), { recursive: true });

  // Launch browser with video recording
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: join(projectDir, 'docs'), size: { width: 1280, height: 720 } },
    locale: 'he-IL',
  });
  const page = await context.newPage();

  // Mock the chat endpoint to return a realistic FORM_DATA response
  await page.route('**/api/chat', route => {
    const formData = {
      clientName: 'חברת דוגמה בע"מ',
      clientCompany: 'חברת דוגמה',
      docType: 'quote',
      projectDescription: 'עיצוב ופיתוח אתר תדמית מודרני',
      serviceDetails: 'עיצוב UI/UX מלא\nפיתוח פרונט-אנד\nהתאמה למובייל\nאופטימיזציה למנועי חיפוש',
      pricingItems: [
        { desc: 'עיצוב UI/UX', qty: 1, price: 4500 },
        { desc: 'פיתוח פרונט-אנד', qty: 1, price: 8000 },
        { desc: 'אופטימיזציה SEO', qty: 1, price: 2000 },
      ],
      paymentStructure: 'three',
      timeline: 'שלב א׳ — עיצוב: שבוע 1-2\nשלב ב׳ — פיתוח: שבוע 3-5\nשלב ג׳ — QA ואספקה: שבוע 6',
      notes: 'ההצעה בתוקף ל-30 יום. המחיר אינו כולל מע"מ.',
    };
    const text = `בהחלט! הנה הצעת המחיר שהכנתי עבורך:\n\n**אתר תדמית — חברת דוגמה בע"מ**\n\nהצעה כוללת עיצוב, פיתוח ואופטימיזציה.\n\n<!--FORM_DATA:${JSON.stringify(formData)}-->`;

    // Stream it slowly for realistic effect
    const chunks = text.match(/.{1,30}/g) || [text];
    const body = chunks.map(chunk =>
      `data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`
    ).join('') + 'data: [DONE]\n\n';

    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body,
    });
  });

  // Also mock other routes that might interfere
  await page.route('**/api/recommend-clauses', route =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recommended: {} }) })
  );

  // THE DEMO FLOW

  // 1. Dashboard
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for the app to render (don't use networkidle — update checks keep connections open)
  // Wait for sidebar nav to render (the nav buttons have Hebrew text)
  await page.waitForFunction(() => document.querySelectorAll('button').length > 3, { timeout: 15000 });
  await sleep(3000);

  // 2. Navigate to document builder — use the 5th nav button (index 4)
  const navButtons = page.locator('.nav-sidebar button, nav button');
  const docBuilderBtn = navButtons.nth(4);
  await docBuilderBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  // Fallback: try text match
  const btnByText = page.getByRole('button', { name: /בונה מסמכים/ });
  if (await btnByText.isVisible().catch(() => false)) {
    await btnByText.click();
  } else {
    // Click the 5th button in the sidebar
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const btn = [...buttons].find(b => b.textContent.includes('בונה') || b.textContent.includes('מסמכים'));
      if (btn) btn.click();
    });
  }
  await sleep(2000);

  // 3. Collapse sidebar for more room
  const collapseBtn = page.locator('button:has-text("כווץ")');
  if (await collapseBtn.isVisible()) {
    await collapseBtn.click();
    await sleep(500);
  }

  // 4. Type in chat (typewriter effect)
  const chatInput = page.locator('#userInput');
  await chatInput.click();
  await sleep(500);

  const message = 'צור הצעת מחיר לאתר תדמית עבור חברת דוגמה';
  for (const char of message) {
    await chatInput.type(char, { delay: 60 });
  }
  await sleep(500);

  // 5. Send message
  await page.click('#sendBtn');
  await sleep(3000); // Wait for response to stream

  // 6. Click "מלא טופס" button
  const fillBtn = page.locator('.fill-form-btn').first();
  await fillBtn.waitFor({ state: 'visible', timeout: 10000 });
  await sleep(500);
  await fillBtn.click();
  await sleep(2000);

  // 7. Scroll form to show pricing
  await page.evaluate(() => {
    const panels = document.querySelectorAll('div');
    panels.forEach(p => {
      if (p.scrollHeight > p.clientHeight + 100 && p.offsetWidth > 300 && p.offsetWidth < 800) {
        p.scrollTo({ top: 500, behavior: 'smooth' });
      }
    });
  });
  await sleep(2500);

  // 8. Scroll more to show payment + clauses
  await page.evaluate(() => {
    const panels = document.querySelectorAll('div');
    panels.forEach(p => {
      if (p.scrollHeight > p.clientHeight + 100 && p.offsetWidth > 300 && p.offsetWidth < 800) {
        p.scrollTo({ top: 1200, behavior: 'smooth' });
      }
    });
  });
  await sleep(2500);

  // 9. Back to dashboard
  try {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('בית'));
      if (btn) btn.click();
    });
    await sleep(2000);
  } catch { /* page may have closed */ }

  // END DEMO

  // Close and save video
  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();

  // Get the video file path and rename to docs/demo.webm
  if (video) {
    const videoPath = await video.path();
    console.log('Video saved:', videoPath);

    const { renameSync } = await import('fs');
    const destPath = join(projectDir, 'docs', 'demo.webm');
    try { renameSync(videoPath, destPath); } catch { /* may already be in the right place */ }
    console.log('Demo video at:', destPath);
  }

  // Cleanup
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await sleep(1000);
    if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  }
  try { rmSync(testDataDir, { recursive: true, force: true }); } catch {}

  console.log('\nDone! Convert to GIF with:');
  console.log('  ffmpeg -i docs/demo.webm -vf "fps=12,scale=960:-1:flags=lanczos" -loop 0 docs/demo.gif');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('Demo recording failed:', err);
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGKILL');
  process.exit(1);
});
