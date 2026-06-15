import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const projectDir = new URL('..', import.meta.url).pathname;
const dataDir = mkdtempSync(join(tmpdir(), 'contractor-import-api-'));
const port = 16834;
const baseUrl = `http://127.0.0.1:${port}`;
let server;

before(async () => {
  server = spawn('node', [join(projectDir, 'src/server.mjs')], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(port),
      CONTRACTOR_DATA_DIR: dataDir,
      CONTRACTOR_OPEN: '0',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.resume();
  server.stderr.resume();
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /api/import-markdown', () => {
  it('creates an editable quote draft and preserves the source import', async () => {
    const fixture = readFileSync(join(projectDir, 'tests/fixtures/ai-video-quote.md'), 'utf8');
    const form = new FormData();
    form.append('file', new Blob([fixture], { type: 'text/markdown' }), 'ai-video-quote.md');

    const response = await fetch(`${baseUrl}/api/import-markdown`, { method: 'POST', body: form });
    assert.equal(response.status, 201);
    const imported = await response.json();

    assert.equal(imported.documentType, 'quote');
    assert.equal(imported.formState.clientName, '');
    assert.equal(imported.formState.pricingItems[0].qty, 2);
    assert.equal(imported.formState.pricingItems[0].price, 7000);
    assert.deepEqual(imported.formState.paymentInstallments.map(item => item.percentage), [50, 50]);
    assert.match(imported.formState.paymentNotes, /שוטף \+ 30/);

    const projectResponse = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(imported.projectId)}`);
    const project = await projectResponse.json();
    assert.equal(project.formStates.quote.projectDescription, imported.formState.projectDescription);
    assert.equal(project.imports.length, 1);
    assert.match(project.imports[0].sha256, /^[a-f0-9]{64}$/);
  });

  it('rejects non-Markdown uploads', async () => {
    const form = new FormData();
    form.append('file', new Blob(['not markdown'], { type: 'text/plain' }), 'notes.txt');
    const response = await fetch(`${baseUrl}/api/import-markdown`, { method: 'POST', body: form });
    assert.equal(response.status, 400);
  });
});
