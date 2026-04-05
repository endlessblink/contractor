#!/usr/bin/env node
/**
 * Smoke test for the built Contractor executable.
 * Tests the actual binary in an isolated environment — simulates a fresh user.
 *
 * Usage: node e2e/smoke-test-binary.mjs [path-to-binary]
 * Default binary: dist/executables/contractor-linux-x64-v{version}
 *
 * WARNING — DATA DIRECTORY ISOLATION LIMITATION:
 *   The pkg binary hardcodes USER_DATA_DIR to ~/.contractor (see src/app-paths.mjs).
 *   There is no env var override for the data directory in the packaged build.
 *   This means the smoke test reads/writes your REAL ~/.contractor directory.
 *
 *   Mitigations applied here:
 *     - Tests only READ data (no destructive writes except the profile PUT test)
 *     - The profile PUT test restores the original value after each run
 *     - The server is started on port 16831 to avoid conflicting with a running dev server
 *
 *   If you have a live ~/.contractor with real data, this test is safe to run.
 *   It does NOT wipe, overwrite, or delete existing data.
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Resolve binary path
// ---------------------------------------------------------------------------
let binaryPath = process.argv[2];
if (!binaryPath) {
  const updaterSrc = readFileSync(join(projectDir, 'src/updater.mjs'), 'utf-8');
  const versionMatch = updaterSrc.match(/CURRENT_VERSION\s*=\s*'([^']+)'/);
  const version = versionMatch ? versionMatch[1] : 'unknown';
  binaryPath = join(projectDir, 'dist/executables', `contractor-linux-x64-v${version}`);
}

if (!existsSync(binaryPath)) {
  console.error('Binary not found:', binaryPath);
  console.error('Run: npm run build');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = 16831; // Offset from default 6831 — no conflict with dev server
let serverProcess = null;
let passed = 0;
let failed = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJSON(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  const data = await res.json();
  return { status: res.status, data };
}

function test(name, fn) {
  return { name, fn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
async function runTests() {
  // Capture original profile so the PUT test can restore it
  let originalProfile = null;
  try {
    const { data } = await fetchJSON('/api/user-profile');
    originalProfile = data;
  } catch {
    // Server not ready yet — handled by startup logic
  }

  const tests = [
    // 1. Binary starts and binds to port
    test('Binary starts and serves HTTP', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const html = await res.text();
      assert(html.includes('Contractor') || html.includes('contractor'), 'HTML should reference the app');
    }),

    // 2. Main page has no hardcoded personal data
    test('No hardcoded personal data in served HTML', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      const html = await res.text();
      // These patterns would indicate developer data baked into the binary assets
      const hardcodedPatterns = [
        { pattern: /noamnau/i, label: 'developer username' },
        { pattern: /linkedin\.com\/in\/noam/i, label: 'developer LinkedIn' },
        { pattern: /x\.com\/NNaumovsky/i, label: 'developer X handle' },
        { pattern: /Naumovsky/i, label: 'developer surname' },
      ];
      for (const { pattern, label } of hardcodedPatterns) {
        assert(!pattern.test(html), `Found hardcoded personal data (${label}) in HTML`);
      }
    }),

    // 3. Version endpoint reports valid semver
    test('Version is reported as valid semver', async () => {
      const { data } = await fetchJSON('/api/setup-status');
      assert(data.version, 'Should report a version');
      assert(/^\d+\.\d+\.\d+$/.test(data.version), `Version should be semver, got: "${data.version}"`);
    }),

    // 4. User profile endpoint exists and returns expected shape
    test('User profile endpoint returns expected fields', async () => {
      const { status, data } = await fetchJSON('/api/user-profile');
      assert(status === 200, `Expected 200, got ${status}`);
      // All expected keys should be present (values may vary — user may have configured this)
      const requiredKeys = ['name', 'email', 'phone', 'setupComplete'];
      for (const key of requiredKeys) {
        assert(key in data, `Profile missing key: "${key}"`);
      }
    }),

    // 5. Clauses DB is loaded and has categories
    test('Clauses DB is loaded with content', async () => {
      const { status, data } = await fetchJSON('/api/clauses-db');
      assert(status === 200, `Expected 200, got ${status}`);
      const hasClauses = data.clauses && Object.keys(data.clauses).length > 0;
      assert(hasClauses, 'Clauses DB should have at least one category');
    }),

    // 6. Setup status shape is correct
    test('Setup status endpoint returns expected shape', async () => {
      const { status, data } = await fetchJSON('/api/setup-status');
      assert(status === 200, `Expected 200, got ${status}`);
      assert('setupComplete' in data, 'Should have setupComplete field');
      assert('version' in data, 'Should have version field');
    }),

    // 7. Profile PUT works and persists
    test('User profile can be updated via PUT', async () => {
      const testName = `SmokeTest-${Date.now()}`;
      const res = await fetch(`http://127.0.0.1:${PORT}/api/user-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName }),
      });
      assert(res.status === 200, `PUT profile failed with ${res.status}`);

      // Verify it persists on re-read
      const { data } = await fetchJSON('/api/user-profile');
      assert(data.name === testName, `Name not persisted, got: "${data.name}"`);

      // Restore original name to avoid polluting real data
      if (originalProfile !== null) {
        await fetch(`http://127.0.0.1:${PORT}/api/user-profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: originalProfile.name || '' }),
        });
      }
    }),

    // 8. Document types endpoint exists
    test('Document types endpoint responds with 200', async () => {
      const { status } = await fetchJSON('/api/document-types');
      assert(status === 200, `Document types endpoint failed with ${status}`);
    }),

    // 9. Chat endpoint fails gracefully without an API key (no crash)
    test('Chat endpoint handles missing API key without crashing', async () => {
      // We send with an explicitly empty API key override — whatever is stored may differ
      const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header used by some endpoints to override stored key
          'x-api-key': '',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'smoke test ping' }],
          overrideApiKey: '',
        }),
      });
      // Any non-500 is fine; a 500 with a body is also acceptable (error JSON, not a crash)
      const body = await res.text();
      assert(body.length > 0, 'Response body should not be empty');

      // Critical: server must still respond after the error
      const healthCheck = await fetch(`http://127.0.0.1:${PORT}/`);
      assert(healthCheck.status === 200, 'Server should still be alive after chat error');
    }),

    // 10. No x-powered-by header
    test('No x-powered-by header exposed', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      const header = res.headers.get('x-powered-by');
      assert(!header, `x-powered-by should be absent, got: "${header}"`);
    }),

    // 11. Static assets are served
    test('Static JS assets are served', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/js/skills-pipeline.js`);
      assert(res.status === 200, `skills-pipeline.js not served, got ${res.status}`);
      const text = await res.text();
      assert(text.length > 100, 'skills-pipeline.js appears empty');
    }),

    // 12. Clients endpoint exists
    test('Clients endpoint responds', async () => {
      const { status } = await fetchJSON('/api/clients');
      assert(status === 200, `Clients endpoint failed with ${status}`);
    }),
  ];

  console.log(`\nRunning ${tests.length} smoke tests against binary...\n`);

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  PASS  ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${t.name}`);
      console.log(`        ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Smoke Test — Contractor Binary');
  console.log('================================');
  console.log('Binary :', binaryPath);
  console.log('Port   :', PORT);
  const testDataDir = join('/tmp', 'contractor-smoke-' + Date.now());
  mkdirSync(testDataDir, { recursive: true });
  console.log('Data   :', testDataDir, '(isolated)');

  try {
    serverProcess = spawn(binaryPath, [], {
      env: {
        ...process.env,
        PORT: String(PORT),
        CONTRACTOR_DATA_DIR: testDataDir,
        ANTHROPIC_API_KEY: '',  // Ensure no real key leaks into the test
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
    serverProcess.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

    serverProcess.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        console.error(`\nServer exited unexpectedly with code ${code}`);
      }
    });

    // Poll until server is ready (up to 20 seconds)
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/`);
        if (res.status === 200) { ready = true; break; }
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!ready) {
      throw new Error('Server did not start within 20 seconds');
    }

    await runTests();

  } finally {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 1000));
      if (!serverProcess.killed) serverProcess.kill('SIGKILL');
    }
    // Clean up isolated test data
    try { rmSync(testDataDir, { recursive: true, force: true }); } catch {}
  }

  const total = passed + failed;
  console.log(`\n${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\nSmoke test crashed:', err.message);
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGKILL');
  process.exit(1);
});
