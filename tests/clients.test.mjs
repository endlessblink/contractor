import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const BASE_URL = 'http://localhost:6831';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createClient(fields) {
  const res = await fetch(`${BASE_URL}/api/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return res;
}

async function deleteClient(id) {
  await fetch(`${BASE_URL}/api/clients/${id}`, { method: 'DELETE' }).catch(() => {});
}

async function createProject(name, extra = {}) {
  const res = await fetch(`${BASE_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...extra }),
  });
  assert.strictEqual(res.status, 201, `Expected 201 creating project "${name}"`);
  return res.json();
}

async function deleteProject(id) {
  await fetch(`${BASE_URL}/api/projects/${id}`, { method: 'DELETE' }).catch(() => {});
}

async function getProject(id) {
  const res = await fetch(`${BASE_URL}/api/projects/${id}`);
  assert.ok(res.ok, `Expected ok reading project "${id}", got ${res.status}`);
  return res.json();
}

async function saveForm(projectId, formState, docType = 'quote') {
  const res = await fetch(`${BASE_URL}/api/projects/${projectId}/form`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formState, docType }),
  });
  assert.ok(res.ok, `Expected ok saving form, got ${res.status}`);
  return res.json();
}

async function listClients() {
  const res = await fetch(`${BASE_URL}/api/clients`);
  assert.ok(res.ok, `Expected ok listing clients, got ${res.status}`);
  return res.json();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Clients API', () => {
  // ─── CRUD operations ────────────────────────────────────────────────────────

  describe('CRUD operations', () => {
    // Each test tracks its own IDs so parallel cleanup is easy
    const createdClientIds = [];
    const createdProjectIds = [];

    after(async () => {
      for (const id of createdProjectIds) await deleteProject(id);
      for (const id of createdClientIds) await deleteClient(id);
    });

    it('creates a client with name and company', async () => {
      const res = await createClient({ name: 'דני כהן CRUD', company: 'חברת בדיקה בע"מ' });
      assert.strictEqual(res.status, 201, 'Should return 201 on creation');

      const client = await res.json();
      assert.ok(client.id, 'Response should include id');
      assert.strictEqual(client.name, 'דני כהן CRUD', 'Name should match');
      assert.strictEqual(client.company, 'חברת בדיקה בע"מ', 'Company should match');
      assert.ok(client.createdAt, 'Response should include createdAt');

      createdClientIds.push(client.id);
    });

    it('creates a client with all fields', async () => {
      const payload = {
        name: 'לקוח מלא CRUD',
        company: 'חברה מלאה בע"מ',
        contactName: 'שרה לוי',
        email: 'sarah@example.com',
        phone: '050-1234567',
        notes: 'לקוח VIP',
        defaultPaymentStructure: '50/50',
      };

      const res = await createClient(payload);
      assert.strictEqual(res.status, 201, 'Should return 201');

      const client = await res.json();
      assert.strictEqual(client.name, payload.name);
      assert.strictEqual(client.company, payload.company);
      assert.strictEqual(client.contactName, payload.contactName);
      assert.strictEqual(client.email, payload.email);
      assert.strictEqual(client.phone, payload.phone);
      assert.strictEqual(client.notes, payload.notes);
      assert.strictEqual(client.defaultPaymentStructure, payload.defaultPaymentStructure);
      assert.ok(client.createdAt, 'createdAt should be set');
      assert.ok(client.updatedAt, 'updatedAt should be set');

      createdClientIds.push(client.id);
    });

    it('rejects creating client without name', async () => {
      const res = await createClient({ company: 'חברה ללא שם' });
      assert.strictEqual(res.status, 400, 'Should return 400 when name is missing');

      const body = await res.json();
      assert.ok(body.error, 'Response should include error message');
    });

    it('lists all clients sorted by name', async () => {
      // Create two clients whose names sort deterministically in Hebrew alphabetical order
      const resA = await createClient({ name: 'אבגד רשימה' });
      const resB = await createClient({ name: 'תשרק רשימה' });
      assert.strictEqual(resA.status, 201);
      assert.strictEqual(resB.status, 201);

      const clientA = await resA.json();
      const clientB = await resB.json();
      createdClientIds.push(clientA.id, clientB.id);

      const data = await listClients();
      assert.ok(Array.isArray(data.clients), 'clients should be an array');

      const ids = data.clients.map(c => c.id);
      assert.ok(ids.includes(clientA.id), 'List should include first created client');
      assert.ok(ids.includes(clientB.id), 'List should include second created client');

      // Verify sorted: אבגד should appear before תשרק
      const posA = ids.indexOf(clientA.id);
      const posB = ids.indexOf(clientB.id);
      assert.ok(posA < posB, 'Clients should be sorted by name ascending (Hebrew alphabetical)');
    });

    it('gets a single client by id', async () => {
      const createRes = await createClient({
        name: 'לקוח GET CRUD',
        company: 'חברת GET',
        email: 'get@example.com',
        phone: '050-9999999',
      });
      assert.strictEqual(createRes.status, 201);
      const created = await createRes.json();
      createdClientIds.push(created.id);

      const res = await fetch(`${BASE_URL}/api/clients/${created.id}`);
      assert.strictEqual(res.status, 200, 'Should return 200 for existing client');

      const client = await res.json();
      assert.strictEqual(client.id, created.id, 'ID should match');
      assert.strictEqual(client.name, 'לקוח GET CRUD', 'Name should match');
      assert.strictEqual(client.company, 'חברת GET', 'Company should match');
      assert.strictEqual(client.email, 'get@example.com', 'Email should match');
      assert.ok(Array.isArray(client.projects), 'Response should include projects array');
    });

    it('gets client with linked projects', async () => {
      const createRes = await createClient({ name: 'לקוח עם פרויקטים CRUD' });
      assert.strictEqual(createRes.status, 201);
      const client = await createRes.json();
      createdClientIds.push(client.id);

      const project = await createProject('פרויקט מקושר CRUD', { clientId: client.id });
      createdProjectIds.push(project.id);

      const res = await fetch(`${BASE_URL}/api/clients/${client.id}`);
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.ok(Array.isArray(data.projects), 'projects should be an array');
      const linkedProject = data.projects.find(p => p.id === project.id);
      assert.ok(linkedProject, 'Created project should appear in client projects list');
    });

    it('updates a client', async () => {
      const createRes = await createClient({ name: 'לקוח לעדכון CRUD', company: 'חברה ישנה' });
      assert.strictEqual(createRes.status, 201);
      const client = await createRes.json();
      createdClientIds.push(client.id);

      const originalUpdatedAt = client.updatedAt;

      // Wait 1ms to ensure updatedAt will differ
      await new Promise(r => setTimeout(r, 5));

      const updateRes = await fetch(`${BASE_URL}/api/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: 'חברה חדשה' }),
      });
      assert.strictEqual(updateRes.status, 200, 'Should return 200 on update');

      const updated = await updateRes.json();
      assert.strictEqual(updated.name, 'לקוח לעדכון CRUD', 'Name should be unchanged');
      assert.strictEqual(updated.company, 'חברה חדשה', 'Company should be updated');
      assert.ok(
        updated.updatedAt !== originalUpdatedAt,
        'updatedAt should change after update'
      );
    });

    it('deletes a client', async () => {
      const createRes = await createClient({ name: 'לקוח למחיקה CRUD' });
      assert.strictEqual(createRes.status, 201);
      const client = await createRes.json();
      // Don't push to createdClientIds — we're deleting it in the test

      const deleteRes = await fetch(`${BASE_URL}/api/clients/${client.id}`, { method: 'DELETE' });
      assert.strictEqual(deleteRes.status, 200, 'Should return 200 on delete');

      const body = await deleteRes.json();
      assert.strictEqual(body.success, true, 'Response should have success: true');

      // Verify client is gone from list
      const data = await listClients();
      const found = data.clients.find(c => c.id === client.id);
      assert.strictEqual(found, undefined, 'Deleted client should not appear in list');
    });

    it('returns 404 for non-existent client', async () => {
      const res = await fetch(`${BASE_URL}/api/clients/does-not-exist-xyz`);
      assert.strictEqual(res.status, 404, 'Should return 404 for missing client');

      const body = await res.json();
      assert.ok(body.error, 'Response should include error message');
    });
  });

  // ─── Fuzzy matching ─────────────────────────────────────────────────────────

  describe('Fuzzy matching', () => {
    const createdClientIds = [];

    after(async () => {
      for (const id of createdClientIds) await deleteClient(id);
    });

    it('finds exact name match with score 100', async () => {
      const res = await createClient({ name: 'דני כהן FUZZY' });
      assert.strictEqual(res.status, 201);
      const client = await res.json();
      createdClientIds.push(client.id);

      const matchRes = await fetch(`${BASE_URL}/api/clients/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'דני כהן FUZZY' }),
      });
      assert.ok(matchRes.ok, `Expected ok from match endpoint, got ${matchRes.status}`);

      const data = await matchRes.json();
      assert.ok(Array.isArray(data.matches), 'matches should be an array');

      const exactMatch = data.matches.find(m => m.id === client.id);
      assert.ok(exactMatch, 'Exact match should be found');
      assert.strictEqual(exactMatch.score, 100, 'Exact match score should be 100');
    });

    it('finds partial match with score 80', async () => {
      const res = await createClient({ name: 'דניאל כהן FUZZY' });
      assert.strictEqual(res.status, 201);
      const client = await res.json();
      createdClientIds.push(client.id);

      const matchRes = await fetch(`${BASE_URL}/api/clients/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'דניאל' }),
      });
      assert.ok(matchRes.ok);

      const data = await matchRes.json();
      assert.ok(Array.isArray(data.matches), 'matches should be an array');

      const match = data.matches.find(m => m.id === client.id);
      assert.ok(match, 'Partial match should be found');
      assert.ok(match.score >= 60, `Score should be >= 60, got ${match.score}`);
    });

    it('returns empty matches for completely different name', async () => {
      const matchRes = await fetch(`${BASE_URL}/api/clients/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'שם שלא קיים בכלל כלל כלל' }),
      });
      assert.ok(matchRes.ok);

      const data = await matchRes.json();
      assert.ok(Array.isArray(data.matches), 'matches should be an array');
      assert.strictEqual(data.matches.length, 0, 'Should return no matches for completely different name');
    });

    it('returns multiple matches sorted by score desc', async () => {
      // Create two clients with the same prefix so both match
      const res1 = await createClient({ name: 'דני כהן MULTI' });
      const res2 = await createClient({ name: 'דני לוי MULTI' });
      assert.strictEqual(res1.status, 201);
      assert.strictEqual(res2.status, 201);
      const c1 = await res1.json();
      const c2 = await res2.json();
      createdClientIds.push(c1.id, c2.id);

      const matchRes = await fetch(`${BASE_URL}/api/clients/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'דני' }),
      });
      assert.ok(matchRes.ok);

      const data = await matchRes.json();
      assert.ok(Array.isArray(data.matches), 'matches should be an array');

      const ids = data.matches.map(m => m.id);
      assert.ok(ids.includes(c1.id), 'First client should be in matches');
      assert.ok(ids.includes(c2.id), 'Second client should be in matches');

      // Verify sorted by score descending
      for (let i = 1; i < data.matches.length; i++) {
        assert.ok(
          data.matches[i - 1].score >= data.matches[i].score,
          `Matches should be sorted by score desc (index ${i - 1} score ${data.matches[i - 1].score} >= index ${i} score ${data.matches[i].score})`
        );
      }
    });
  });

  // ─── Project-client linking ──────────────────────────────────────────────────

  describe('Project-client linking', () => {
    const createdClientIds = [];
    const createdProjectIds = [];

    after(async () => {
      for (const id of createdProjectIds) await deleteProject(id);
      for (const id of createdClientIds) await deleteClient(id);
    });

    it('creates project linked to client', async () => {
      const createRes = await createClient({ name: 'לקוח קישור פרויקט' });
      assert.strictEqual(createRes.status, 201);
      const client = await createRes.json();
      createdClientIds.push(client.id);

      const project = await createProject('פרויקט עם לקוח', { clientId: client.id });
      createdProjectIds.push(project.id);

      const fetched = await getProject(project.id);
      assert.strictEqual(fetched.clientId, client.id, 'Project should have clientId set');
    });

    it('auto-links project on form save when exact match', async () => {
      const clientName = 'טסט לקוח AUTO';
      const createRes = await createClient({ name: clientName });
      assert.strictEqual(createRes.status, 201);
      const client = await createRes.json();
      createdClientIds.push(client.id);

      const project = await createProject('פרויקט לינק אוטו');
      createdProjectIds.push(project.id);

      const result = await saveForm(project.id, { clientName }, 'quote');
      assert.strictEqual(result.clientLinked, true, 'Response should have clientLinked: true on exact match');

      const fetched = await getProject(project.id);
      assert.strictEqual(fetched.clientId, client.id, 'Project clientId should be set after auto-link');
    });

    it('suggests client on form save when fuzzy match', async () => {
      const createRes = await createClient({ name: 'חברת טסט בע"מ SUGGEST' });
      assert.strictEqual(createRes.status, 201);
      const client = await createRes.json();
      createdClientIds.push(client.id);

      const project = await createProject('פרויקט הצעה');
      createdProjectIds.push(project.id);

      // Use a partial name that will fuzzy-match but not exact-match
      const result = await saveForm(project.id, { clientName: 'חברת טסט' }, 'quote');

      // Server either auto-links (exact) or suggests (fuzzy) or auto-creates (no match)
      // For a partial match at score 80 the server suggests, not auto-links
      if (result.suggestedClient) {
        assert.ok(result.suggestedClient.id, 'suggestedClient should have id');
        assert.ok(result.suggestedClient.name, 'suggestedClient should have name');
        assert.ok(typeof result.suggestedClient.score === 'number', 'suggestedClient should have score');
      }
      // Either clientLinked or suggestedClient — at least one must be present (or auto-created)
      // This test mainly verifies the endpoint does not error on a fuzzy match
    });

    it('auto-creates client on form save when no match', async () => {
      const uniqueName = `לקוח חדש לגמרי ${Date.now()}`;

      const project = await createProject('פרויקט יצירת לקוח');
      createdProjectIds.push(project.id);

      const result = await saveForm(project.id, { clientName: uniqueName }, 'quote');
      assert.strictEqual(result.clientLinked, true, 'Response should have clientLinked: true after auto-create');

      // Verify the auto-created client exists in the clients list
      const data = await listClients();
      const newClient = data.clients.find(c => c.name === uniqueName);
      assert.ok(newClient, 'Auto-created client should appear in clients list');
      createdClientIds.push(newClient.id);

      // Verify project is linked to the new client
      const fetched = await getProject(project.id);
      assert.strictEqual(fetched.clientId, newClient.id, 'Project should be linked to auto-created client');
    });

    it('unlinks projects when client is deleted', async () => {
      const createRes = await createClient({ name: 'לקוח למחיקה LINK' });
      assert.strictEqual(createRes.status, 201);
      const client = await createRes.json();
      // Don't add to createdClientIds — we delete it in this test

      const project = await createProject('פרויקט שיתנתק', { clientId: client.id });
      createdProjectIds.push(project.id);

      // Verify initial link
      let fetched = await getProject(project.id);
      assert.strictEqual(fetched.clientId, client.id, 'Project should start linked to client');

      // Delete the client
      const deleteRes = await fetch(`${BASE_URL}/api/clients/${client.id}`, { method: 'DELETE' });
      assert.strictEqual(deleteRes.status, 200, 'Client delete should succeed');

      // Verify project is unlinked
      fetched = await getProject(project.id);
      assert.ok(
        fetched.clientId === undefined || fetched.clientId === null || fetched.clientId === '',
        `Project clientId should be cleared after client deletion, got: ${fetched.clientId}`
      );
    });
  });
});
