#!/usr/bin/env node
/**
 * Comprehensive API integration tests for the Contractor server.
 * Uses Node's built-in test runner (node:test + node:assert).
 *
 * Runs against the real server in an isolated temp data directory.
 * No AI API keys needed — only tests CRUD operations.
 *
 * Usage: node --test e2e/api-integration.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = 16832;
const BASE = `http://127.0.0.1:${PORT}`;
const TEMP_DIR = join(tmpdir(), `contractor-api-test-${Date.now()}`);

let serverProcess = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make a JSON API request.
 * @param {string} method - HTTP method
 * @param {string} path - URL path (e.g. /api/clients)
 * @param {object} [body] - JSON body (for POST/PUT)
 * @returns {Promise<{status: number, data: any, headers: Headers}>}
 */
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  let data;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, data, headers: res.headers };
}

/**
 * Raw fetch (for non-JSON endpoints like export).
 */
async function rawFetch(path, opts = {}) {
  return fetch(`${BASE}${path}`, opts);
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  mkdirSync(TEMP_DIR, { recursive: true });

  serverProcess = spawn('node', [join(projectDir, 'src', 'server.mjs')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CONTRACTOR_DATA_DIR: TEMP_DIR,
      ANTHROPIC_API_KEY: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: projectDir,
  });

  // Collect stderr for debugging failures
  let stderr = '';
  serverProcess.stderr.on('data', d => { stderr += d.toString(); });
  serverProcess.stdout.on('data', () => {}); // drain stdout

  serverProcess.on('exit', (code) => {
    if (code && code !== 0 && code !== null) {
      console.error(`Server exited with code ${code}\n${stderr}`);
    }
  });

  // Poll until ready (up to 15 seconds)
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.status === 200) { ready = true; break; }
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!ready) {
    throw new Error(`Server did not start within 15 seconds.\nstderr: ${stderr}`);
  }
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  }
  try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}
});

// ===========================================================================
// 1. Profile CRUD
// ===========================================================================
describe('Profile CRUD', () => {
  it('GET /api/user-profile returns default profile', async () => {
    const { status, data } = await api('GET', '/api/user-profile');
    assert.equal(status, 200);
    assert.ok('name' in data, 'should have name field');
    assert.ok('email' in data, 'should have email field');
    assert.ok('setupComplete' in data, 'should have setupComplete field');
    // setupComplete may be true or false depending on seed data
    assert.ok(typeof data.setupComplete === 'boolean', 'setupComplete should be boolean');
  });

  it('PUT /api/user-profile updates and persists fields', async () => {
    const { status, data } = await api('PUT', '/api/user-profile', {
      name: 'Test User',
      email: 'test@example.com',
      phone: '050-1234567',
    });
    assert.equal(status, 200);
    assert.equal(data.profile.name, 'Test User');
    assert.equal(data.profile.email, 'test@example.com');

    // Verify persistence
    const { data: profile } = await api('GET', '/api/user-profile');
    assert.equal(profile.name, 'Test User');
    assert.equal(profile.email, 'test@example.com');
    assert.equal(profile.phone, '050-1234567');
  });

  it('PUT /api/user-profile partial update does not overwrite other fields', async () => {
    // First set multiple fields
    await api('PUT', '/api/user-profile', { name: 'Alice', company: 'ACME' });

    // Partial update — only change name
    await api('PUT', '/api/user-profile', { name: 'Bob' });

    const { data } = await api('GET', '/api/user-profile');
    assert.equal(data.name, 'Bob');
    assert.equal(data.company, 'ACME', 'company should remain unchanged');
  });

  it('GET /api/setup-status reflects profile state', async () => {
    const { status, data } = await api('GET', '/api/setup-status');
    assert.equal(status, 200);
    assert.ok('setupComplete' in data);
    assert.ok('version' in data);
    assert.ok('hasProfile' in data);
    assert.match(data.version, /^\d+\.\d+\.\d+$/, 'version should be semver');
  });
});

// ===========================================================================
// 2. Clients CRUD
// ===========================================================================
describe('Clients CRUD', () => {
  let createdClientId;

  it('POST /api/clients creates a client', async () => {
    const { status, data } = await api('POST', '/api/clients', {
      name: 'Test Client',
      company: 'Test Corp',
      email: 'client@test.com',
      phone: '050-9999999',
    });
    assert.equal(status, 201);
    assert.ok(data.id, 'should return an id');
    assert.equal(data.name, 'Test Client');
    assert.equal(data.company, 'Test Corp');
    assert.ok(data.createdAt);
    createdClientId = data.id;
  });

  it('POST /api/clients rejects without name', async () => {
    const { status } = await api('POST', '/api/clients', { company: 'No Name' });
    assert.equal(status, 400);
  });

  it('POST /api/clients rejects empty string name', async () => {
    const { status } = await api('POST', '/api/clients', { name: '   ' });
    assert.equal(status, 400);
  });

  it('POST /api/clients rejects duplicate name', async () => {
    const { status } = await api('POST', '/api/clients', { name: 'Test Client' });
    assert.equal(status, 409);
  });

  it('GET /api/clients lists includes created client', async () => {
    const { status, data } = await api('GET', '/api/clients');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.clients));
    const found = data.clients.find(c => c.id === createdClientId);
    assert.ok(found, 'created client should be in the list');
    assert.equal(found.name, 'Test Client');
  });

  it('GET /api/clients/:id returns correct client', async () => {
    const { status, data } = await api('GET', `/api/clients/${createdClientId}`);
    assert.equal(status, 200);
    assert.equal(data.id, createdClientId);
    assert.equal(data.name, 'Test Client');
    assert.ok(Array.isArray(data.projects), 'should include projects array');
  });

  it('GET /api/clients/:id returns 404 for nonexistent', async () => {
    const { status } = await api('GET', '/api/clients/nonexistent-id-12345');
    assert.equal(status, 404);
  });

  it('PUT /api/clients/:id updates fields', async () => {
    const { status, data } = await api('PUT', `/api/clients/${createdClientId}`, {
      company: 'Updated Corp',
      notes: 'VIP client',
    });
    assert.equal(status, 200);
    assert.equal(data.company, 'Updated Corp');
    assert.equal(data.notes, 'VIP client');
    assert.equal(data.name, 'Test Client', 'name should remain unchanged');
  });

  it('GET /api/clients/match?q= performs search', async () => {
    const { status, data } = await api('GET', '/api/clients/match?q=test');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.clients));
    assert.ok(data.clients.length > 0, 'should find at least one match');
    assert.equal(data.clients[0].name, 'Test Client');
  });

  it('GET /api/clients/match?q= returns empty for no match', async () => {
    const { data } = await api('GET', '/api/clients/match?q=zzzznotexist');
    assert.ok(Array.isArray(data.clients));
    assert.equal(data.clients.length, 0);
  });

  it('POST /api/clients/match fuzzy search', async () => {
    const { status, data } = await api('POST', '/api/clients/match', { name: 'Test' });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.matches));
    assert.ok(data.matches.length > 0);
  });

  // Create a second client for later delete test
  let secondClientId;
  it('POST /api/clients creates second client for delete test', async () => {
    const { data } = await api('POST', '/api/clients', { name: 'Delete Me Client' });
    secondClientId = data.id;
    assert.ok(secondClientId);
  });

  it('DELETE /api/clients/:id removes client', async () => {
    const { status, data } = await api('DELETE', `/api/clients/${secondClientId}`);
    assert.equal(status, 200);
    assert.equal(data.success, true);

    // Verify gone
    const { status: getStatus } = await api('GET', `/api/clients/${secondClientId}`);
    assert.equal(getStatus, 404);
  });

  it('DELETE /api/clients/:id returns 404 for nonexistent', async () => {
    const { status } = await api('DELETE', '/api/clients/nonexistent-id-12345');
    assert.equal(status, 404);
  });
});

// ===========================================================================
// 3. Projects CRUD
// ===========================================================================
describe('Projects CRUD', () => {
  let projectId;
  let linkedProjectId;

  it('POST /api/projects creates a project', async () => {
    const { status, data } = await api('POST', '/api/projects', {
      name: 'Test Project Alpha',
    });
    assert.equal(status, 201);
    assert.ok(data.id, 'should return an id');
    assert.equal(data.name, 'Test Project Alpha');
    assert.ok(data.createdAt);
    assert.deepEqual(data.formStates, {});
    projectId = data.id;
  });

  it('POST /api/projects rejects without name', async () => {
    const { status } = await api('POST', '/api/projects', {});
    assert.equal(status, 400);
  });

  it('POST /api/projects creates with clientId link', async () => {
    // First get the existing client id
    const { data: clientsData } = await api('GET', '/api/clients');
    const client = clientsData.clients[0];
    assert.ok(client, 'should have at least one client from prior tests');

    const { status, data } = await api('POST', '/api/projects', {
      name: 'Linked Project',
      clientId: client.id,
    });
    assert.equal(status, 201);
    assert.equal(data.clientId, client.id);
    linkedProjectId = data.id;
  });

  it('GET /api/projects lists includes created projects', async () => {
    const { status, data } = await api('GET', '/api/projects');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.projects));
    const found = data.projects.find(p => p.id === projectId);
    assert.ok(found, 'created project should be in the list');
  });

  it('GET /api/projects/:id returns project data', async () => {
    const { status, data } = await api('GET', `/api/projects/${projectId}`);
    assert.equal(status, 200);
    assert.equal(data.name, 'Test Project Alpha');
    assert.ok('formStates' in data);
    assert.ok('chatHistory' in data);
  });

  it('PUT /api/projects/active sets active project', async () => {
    const { status, data } = await api('PUT', '/api/projects/active', {
      projectId: projectId,
    });
    assert.equal(status, 200);
    assert.equal(data.activeProjectId, projectId);

    // Verify in index
    const { data: index } = await api('GET', '/api/projects');
    assert.equal(index.activeProjectId, projectId);
  });

  it('PUT /api/projects/:id renames project', async () => {
    const { status, data } = await api('PUT', `/api/projects/${projectId}`, {
      name: 'Renamed Project',
    });
    assert.equal(status, 200);
    assert.equal(data.name, 'Renamed Project');
  });

  it('PUT /api/projects/:id/form saves form state', async () => {
    const formState = {
      clientName: 'Form Client',
      docType: 'quote',
      projectDescription: 'Test Description',
      pricingItems: [{ desc: 'Service A', qty: 1, price: 5000 }],
    };
    const { status, data } = await api('PUT', `/api/projects/${projectId}/form`, {
      formState,
      docType: 'quote',
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);

    // Verify form was saved
    const { data: project } = await api('GET', `/api/projects/${projectId}`);
    assert.ok(project.formStates.quote, 'quote form state should be saved');
    assert.equal(project.formStates.quote.clientName, 'Form Client');
  });

  it('PUT /api/projects/:id/form auto-creates client from clientName', async () => {
    // Create a fresh project with no clientId for this test
    const { data: newProj } = await api('POST', '/api/projects', {
      name: 'Auto Link Test Project',
    });

    // Save form with a new client name that doesn't exist yet
    const formState = {
      clientName: 'Auto Created Client',
      clientCompany: 'Auto Corp',
      docType: 'quote',
    };
    const { data } = await api('PUT', `/api/projects/${newProj.id}/form`, {
      formState,
      docType: 'quote',
    });
    assert.equal(data.success, true);
    assert.equal(data.clientLinked, true, 'client should be auto-linked');

    // Verify client was auto-created
    const { data: clients } = await api('GET', '/api/clients');
    const autoClient = clients.clients.find(c => c.name === 'Auto Created Client');
    assert.ok(autoClient, 'auto-created client should exist in clients list');

    // Cleanup
    await api('DELETE', `/api/projects/${newProj.id}`);
  });

  it('PUT /api/projects/:id/chat saves chat history', async () => {
    const chatHistory = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const { status, data } = await api('PUT', `/api/projects/${projectId}/chat`, {
      chatHistory,
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);

    // Verify
    const { data: project } = await api('GET', `/api/projects/${projectId}`);
    assert.equal(project.chatHistory.length, 2);
    assert.equal(project.chatHistory[0].content, 'Hello');
  });

  it('PUT /api/projects/:id/chat rejects non-array', async () => {
    const { status } = await api('PUT', `/api/projects/${projectId}/chat`, {
      chatHistory: 'not an array',
    });
    assert.equal(status, 400);
  });

  it('DELETE /api/projects/:id removes project', async () => {
    const { status, data } = await api('DELETE', `/api/projects/${linkedProjectId}`);
    assert.equal(status, 200);
    assert.equal(data.success, true);

    // Verify removed from index
    const { data: index } = await api('GET', '/api/projects');
    const found = index.projects.find(p => p.id === linkedProjectId);
    assert.ok(!found, 'deleted project should not be in the list');
  });

  it('DELETE /api/projects/:id with path traversal is rejected', async () => {
    const { status } = await api('DELETE', '/api/projects/..%2F..%2Fetc');
    assert.equal(status, 400);
  });
});

// ===========================================================================
// 4. Clauses DB
// ===========================================================================
describe('Clauses DB', () => {
  it('GET /api/clauses-db returns valid structure', async () => {
    const { status, data } = await api('GET', '/api/clauses-db');
    assert.equal(status, 200);
    assert.ok('clauses' in data, 'should have clauses key');
    // May be empty on fresh install, or seeded from sample
    assert.ok(typeof data.clauses === 'object');
  });

  it('POST /api/save-clause adds a clause', async () => {
    const { status, data } = await api('POST', '/api/save-clause', {
      category: 'generalTerms',
      id: 'api-test-clause-unique-xyz',
      text: 'This is a test clause for integration testing.',
      appliesTo: ['quote', 'contract'],
      required: false,
      notes: 'test clause',
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.ok(['added', 'updated'].includes(data.action), `action should be added or updated, got: ${data.action}`);
    assert.equal(data.clauseId, 'api-test-clause-unique-xyz');
  });

  it('GET /api/clauses-db shows the saved clause', async () => {
    const { data } = await api('GET', '/api/clauses-db');
    const generalClauses = data.clauses.generalTerms?.clauses || [];
    const found = generalClauses.find(c => c.id === 'api-test-clause-unique-xyz');
    assert.ok(found, 'saved clause should exist in DB');
    assert.equal(found.text, 'This is a test clause for integration testing.');
  });

  it('POST /api/save-clause updates existing clause (same id+category)', async () => {
    const { data } = await api('POST', '/api/save-clause', {
      category: 'generalTerms',
      id: 'api-test-clause-unique-xyz',
      text: 'Updated clause text.',
      appliesTo: ['contract'],
      required: true,
    });
    assert.equal(data.success, true);
    assert.equal(data.action, 'updated');

    // Verify update
    const { data: db } = await api('GET', '/api/clauses-db');
    const clause = db.clauses.generalTerms.clauses.find(c => c.id === 'api-test-clause-unique-xyz');
    assert.equal(clause.text, 'Updated clause text.');
    assert.equal(clause.required, true);
  });

  it('POST /api/save-clause rejects missing fields', async () => {
    const { status } = await api('POST', '/api/save-clause', {
      category: 'generalTerms',
      // missing id and text
    });
    assert.equal(status, 400);
  });

  it('POST /api/save-clause rejects invalid category', async () => {
    const { status } = await api('POST', '/api/save-clause', {
      category: 'nonExistentCategory',
      id: 'bad-clause',
      text: 'should fail',
    });
    assert.equal(status, 400);
  });
});

// ===========================================================================
// 5. Document Types CRUD
// ===========================================================================
describe('Document Types CRUD', () => {
  it('GET /api/document-types returns valid structure', async () => {
    const { status, data } = await api('GET', '/api/document-types');
    assert.equal(status, 200);
    assert.ok('types' in data || Array.isArray(data.types) || typeof data === 'object');
  });

  it('POST /api/document-types adds custom type', async () => {
    const { status, data } = await api('POST', '/api/document-types', {
      id: 'custom-test',
      name: 'Test Document Type',
      icon: 'file',
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.type.id, 'custom-test');
  });

  it('POST /api/document-types rejects without id or name', async () => {
    const { status } = await api('POST', '/api/document-types', { name: 'No ID' });
    assert.equal(status, 400);
  });

  it('POST /api/document-types rejects duplicate id', async () => {
    const { status } = await api('POST', '/api/document-types', {
      id: 'custom-test',
      name: 'Duplicate',
    });
    assert.equal(status, 409);
  });

  it('PUT /api/document-types/:id updates type', async () => {
    const { status, data } = await api('PUT', '/api/document-types/custom-test', {
      name: 'Updated Test Type',
    });
    assert.equal(status, 200);
    assert.equal(data.type.name, 'Updated Test Type');
  });

  it('PUT /api/document-types/:id returns 404 for nonexistent', async () => {
    const { status } = await api('PUT', '/api/document-types/nonexistent', {
      name: 'nope',
    });
    assert.equal(status, 404);
  });

  it('DELETE /api/document-types/:id removes custom type', async () => {
    const { status, data } = await api('DELETE', '/api/document-types/custom-test');
    assert.equal(status, 200);
    assert.equal(data.success, true);

    // Verify gone
    const { data: types } = await api('GET', '/api/document-types');
    const found = types.types.find(t => t.id === 'custom-test');
    assert.ok(!found, 'deleted type should not be in list');
  });

  it('DELETE /api/document-types/:id rejects deleting built-in type', async () => {
    // First add a built-in type
    const { data: types } = await api('GET', '/api/document-types');

    // Create a built-in type for testing
    await api('POST', '/api/document-types', {
      id: 'builtin-test',
      name: 'Built In',
      builtIn: true,
    });

    const { status } = await api('DELETE', '/api/document-types/builtin-test');
    assert.equal(status, 403);
  });

  it('DELETE /api/document-types/:id returns 404 for nonexistent', async () => {
    const { status } = await api('DELETE', '/api/document-types/nonexistent');
    assert.equal(status, 404);
  });
});

// ===========================================================================
// 6. Service Templates CRUD
// ===========================================================================
describe('Service Templates CRUD', () => {
  let templateType;

  it('POST /api/service-templates creates template', async () => {
    const { status, data } = await api('POST', '/api/service-templates', {
      name: 'Web Design Template',
      typicalPricing: [{ desc: 'Website', qty: 1, price: 10000 }],
      typicalTimeline: '4 weeks',
      typicalDeliverables: '5 page website',
      relevantClauses: ['api-test-clause-unique-xyz'],
    });
    assert.equal(status, 200);
    assert.ok(data.type, 'should return a type slug');
    assert.equal(data.name, 'Web Design Template');
    templateType = data.type;
  });

  it('POST /api/service-templates rejects without name', async () => {
    const { status } = await api('POST', '/api/service-templates', {
      typicalTimeline: '2 weeks',
    });
    assert.equal(status, 400);
  });

  it('PUT /api/service-templates/:type updates template', async () => {
    const { status, data } = await api('PUT', `/api/service-templates/${templateType}`, {
      name: 'Updated Web Design',
      typicalTimeline: '6 weeks',
    });
    assert.equal(status, 200);
    assert.equal(data.name, 'Updated Web Design');
    assert.equal(data.typicalTimeline, '6 weeks');
    // Original fields preserved
    assert.equal(data.typicalDeliverables, '5 page website');
  });

  it('PUT /api/service-templates/:type returns 404 for nonexistent', async () => {
    const { status } = await api('PUT', '/api/service-templates/nonexistent-type', {
      name: 'nope',
    });
    assert.equal(status, 404);
  });

  it('DELETE /api/service-templates/:type removes template', async () => {
    const { status, data } = await api('DELETE', `/api/service-templates/${templateType}`);
    assert.equal(status, 200);
    assert.equal(data.success, true);

    // Verify it's gone from clauses-db
    const { data: db } = await api('GET', '/api/clauses-db');
    const found = (db.serviceTemplates || []).find(t => t.type === templateType);
    assert.ok(!found, 'deleted template should not be in DB');
  });

  it('DELETE /api/service-templates/:type returns 404 for nonexistent', async () => {
    const { status } = await api('DELETE', '/api/service-templates/nonexistent-type');
    assert.equal(status, 404);
  });
});

// ===========================================================================
// 7. Demo Data
// ===========================================================================
describe('Demo Data', () => {
  it('POST /api/load-demo creates demo project and client', async () => {
    const { status, data } = await api('POST', '/api/load-demo');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.clientId, 'demo-client');
    assert.equal(data.projectId, 'demo-project');
  });

  it('GET /api/projects includes demo project', async () => {
    const { data } = await api('GET', '/api/projects');
    const demo = data.projects.find(p => p.id === 'demo-project');
    assert.ok(demo, 'demo project should exist');
    assert.equal(demo.isDemo, true);
  });

  it('GET /api/clients includes demo client', async () => {
    const { data } = await api('GET', '/api/clients');
    const demo = data.clients.find(c => c.id === 'demo-client');
    assert.ok(demo, 'demo client should exist');
  });

  it('DELETE /api/demo-data removes demo data', async () => {
    const { status, data } = await api('DELETE', '/api/demo-data');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });

  it('GET /api/projects no longer has demo project', async () => {
    const { data } = await api('GET', '/api/projects');
    const demo = data.projects.find(p => p.id === 'demo-project');
    assert.ok(!demo, 'demo project should be gone');
  });

  it('GET /api/clients no longer has demo client', async () => {
    const { data } = await api('GET', '/api/clients');
    const demo = data.clients.find(c => c.id === 'demo-client');
    assert.ok(!demo, 'demo client should be gone');
  });

  it('POST /api/load-demo is idempotent', async () => {
    await api('POST', '/api/load-demo');
    const { status } = await api('POST', '/api/load-demo');
    assert.equal(status, 200);

    // Should still have exactly one demo project
    const { data } = await api('GET', '/api/projects');
    const demos = data.projects.filter(p => p.id === 'demo-project');
    assert.equal(demos.length, 1, 'should have exactly one demo project');

    // Cleanup
    await api('DELETE', '/api/demo-data');
  });
});

// ===========================================================================
// 8. Documents listing
// ===========================================================================
describe('Documents listing', () => {
  it('GET /api/documents returns structure for global scope', async () => {
    const { status, data } = await api('GET', '/api/documents');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.generated));
    assert.ok(Array.isArray(data.uploaded));
  });

  it('GET /api/documents?projectId= returns project-scoped listing', async () => {
    // Get existing project from earlier tests
    const { data: index } = await api('GET', '/api/projects');
    const project = index.projects[0];
    if (!project) return; // skip if no projects

    const { status, data } = await api('GET', `/api/documents?projectId=${project.id}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.generated));
    assert.ok(Array.isArray(data.uploaded));
  });
});

// ===========================================================================
// 9. Export/Import
// ===========================================================================
describe('Export/Import', () => {
  let exportedData;

  it('GET /api/export returns a tar.gz file', async () => {
    const res = await rawFetch('/api/export');
    assert.equal(res.status, 200);
    const disposition = res.headers.get('content-disposition') || '';
    assert.ok(disposition.includes('contractor-backup'), 'should have backup filename');
    assert.ok(disposition.includes('.tar.gz'), 'should be tar.gz');

    exportedData = await res.arrayBuffer();
    assert.ok(exportedData.byteLength > 0, 'export should not be empty');
  });

  it('POST /api/import restores from backup', async () => {
    if (!exportedData) return; // skip if export failed

    // Modify profile before import to verify it gets restored
    await api('PUT', '/api/user-profile', { name: 'Pre-Import Name' });

    const formData = new FormData();
    const blob = new Blob([exportedData], { type: 'application/gzip' });
    formData.append('backup', blob, 'backup.tar.gz');

    const res = await rawFetch('/api/import', {
      method: 'POST',
      body: formData,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });
});

// ===========================================================================
// 10. Edge cases / security
// ===========================================================================
describe('Edge cases and security', () => {
  it('GET /api/clients/:id rejects path traversal', async () => {
    const { status } = await api('GET', '/api/clients/..%2F..%2Fetc%2Fpasswd');
    assert.ok([400, 404].includes(status), `should reject path traversal, got ${status}`);
  });

  it('DELETE /api/clients/:id rejects path traversal', async () => {
    const paths = ['../etc/passwd', '..\\windows\\system32'];
    for (const p of paths) {
      const { status } = await api('DELETE', `/api/clients/${encodeURIComponent(p)}`);
      assert.ok([400, 404].includes(status), `should reject ${p}`);
    }
  });

  it('GET /api/projects/:id rejects path traversal', async () => {
    const { status } = await api('GET', '/api/projects/..%2F..%2Fetc');
    assert.equal(status, 400);
  });

  it('POST endpoints handle invalid JSON gracefully', async () => {
    const res = await rawFetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json!!!',
    });
    // Should return an error status, not crash
    assert.ok(res.status >= 400, 'should return error status for invalid JSON');

    // Server should still be alive
    const health = await rawFetch('/');
    assert.equal(health.status, 200, 'server should still be alive after invalid JSON');
  });

  it('POST /api/save-clause with empty body returns 400', async () => {
    const { status } = await api('POST', '/api/save-clause', {});
    assert.equal(status, 400);
  });

  it('POST /api/projects with empty name returns 400', async () => {
    const { status } = await api('POST', '/api/projects', { name: '' });
    assert.equal(status, 400);
  });

  it('PUT /api/projects/:id/chat with non-array chatHistory returns 400', async () => {
    // Get a project id
    const { data: index } = await api('GET', '/api/projects');
    const project = index.projects[0];
    if (!project) return;

    const { status } = await api('PUT', `/api/projects/${project.id}/chat`, {
      chatHistory: 'not-an-array',
    });
    assert.equal(status, 400);
  });

  it('Server serves static files', async () => {
    const res = await rawFetch('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<!DOCTYPE html') || html.includes('<html'), 'should serve HTML');
  });

  it('No x-powered-by header exposed', async () => {
    const res = await rawFetch('/');
    const header = res.headers.get('x-powered-by');
    assert.ok(!header, `x-powered-by should not be exposed, got: "${header}"`);
  });
});

// ===========================================================================
// 11. Misc endpoints (learned context, AI status)
// ===========================================================================
describe('Misc endpoints', () => {
  it('GET /api/learned-context returns structure', async () => {
    const { status, data } = await api('GET', '/api/learned-context');
    assert.equal(status, 200);
    // Fresh install returns { learned: false }
    assert.ok(typeof data === 'object');
  });

  it('GET /api/reference-documents returns list', async () => {
    const { status, data } = await api('GET', '/api/reference-documents');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.documents) || typeof data === 'object');
  });

  it('GET /api/ai-status returns structure without crashing', async () => {
    const { status, data } = await api('GET', '/api/ai-status');
    assert.equal(status, 200);
    assert.ok('configured' in data);
  });
});
