import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  createDefaultContractorServices,
  createContractorMcpServer,
  runContractorMcpServer,
} from '../src/mcp-server.mjs';
import {
  installMcpConfig,
  mergeMcpServerConfig,
} from '../scripts/install-mcp-config.mjs';

const TOOL_NAMES = [
  'contractor_generate_document',
  'contractor_get_project',
  'contractor_import_markdown',
  'contractor_list_clients',
  'contractor_list_projects',
  'contractor_upsert_document_draft',
];

const connections = [];
const tempDirs = [];

async function connectServer(services) {
  const server = createContractorMcpServer({ services });
  const client = new Client({ name: 'contractor-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  connections.push({ client, server });

  return client;
}

function parseTextResult(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

afterEach(async () => {
  while (connections.length) {
    const { client, server } = connections.pop();
    await client.close();
    await server.close();
  }
  while (tempDirs.length) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('Contractor MCP server', () => {
  it('registers exactly six tools and delegates calls to injected services', async () => {
    const calls = [];
    const services = {
      listClients(args) {
        calls.push(['listClients', args]);
        return { clients: [{ id: 'client-1', name: 'Client One' }] };
      },
      listProjects(args) {
        calls.push(['listProjects', args]);
        return { projects: [{ id: 'project-1', name: 'Project One' }] };
      },
      getProject(args) {
        calls.push(['getProject', args]);
        return { id: args.projectId, name: 'Project One' };
      },
      importMarkdown(args) {
        calls.push(['importMarkdown', args]);
        return { projectId: args.projectId, docType: args.docType, imported: true };
      },
      upsertDocumentDraft(args) {
        calls.push(['upsertDocumentDraft', args]);
        return { projectId: args.projectId, docType: args.docType, saved: true };
      },
      generateDocument(args) {
        calls.push(['generateDocument', args]);
        return { filename: 'quote.docx', path: '/tmp/quote.docx' };
      },
    };
    const client = await connectServer(services);

    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), TOOL_NAMES);

    const cases = [
      ['contractor_list_clients', {}, 'listClients'],
      ['contractor_list_projects', {}, 'listProjects'],
      ['contractor_get_project', { projectId: 'project-1' }, 'getProject'],
      ['contractor_import_markdown', {
        markdown: '# Quote',
        filename: 'quote.md',
      }, 'importMarkdown'],
      ['contractor_upsert_document_draft', {
        projectId: 'project-1',
        docType: 'quote',
        formState: { clientName: 'Client One' },
      }, 'upsertDocumentDraft'],
      ['contractor_generate_document', {
        projectId: 'project-1',
        docType: 'quote',
      }, 'generateDocument'],
    ];

    for (const [name, args, serviceName] of cases) {
      const result = await client.callTool({ name, arguments: args });
      const payload = parseTextResult(result);
      assert.equal(result.isError, undefined);
      assert.equal(payload.ok, true);
      assert.equal(payload.tool, name);
      assert.ok(payload.data);
      assert.deepEqual(calls.at(-1), [serviceName, args]);
    }
  });

  it('returns stable JSON errors without exposing stack traces', async () => {
    const services = {
      listClients() {
        const error = new Error('Client database is unavailable');
        error.code = 'CLIENT_DB_UNAVAILABLE';
        throw error;
      },
      listProjects() {},
      getProject() {},
      importMarkdown() {},
      upsertDocumentDraft() {},
      generateDocument() {},
    };
    const client = await connectServer(services);

    const result = await client.callTool({
      name: 'contractor_list_clients',
      arguments: {},
    });
    const payload = parseTextResult(result);

    assert.equal(result.isError, true);
    assert.deepEqual(payload, {
      ok: false,
      tool: 'contractor_list_clients',
      error: {
        code: 'CLIENT_DB_UNAVAILABLE',
        message: 'Client database is unavailable',
      },
    });
    assert.doesNotMatch(result.content[0].text, /\n\s+at\s/);
  });

  it('connects the factory through an injected transport', async () => {
    const services = {
      listClients: () => ({ clients: [] }),
      listProjects: () => ({ projects: [] }),
      getProject: () => ({}),
      importMarkdown: () => ({}),
      upsertDocumentDraft: () => ({}),
      generateDocument: () => ({}),
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'contractor-runner-test', version: '1.0.0' });

    const server = await runContractorMcpServer({ services, transport: serverTransport });
    await client.connect(clientTransport);
    connections.push({ client, server });

    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), TOOL_NAMES);
  });

  it('constructs standalone services from CONTRACTOR_DATA_DIR', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'contractor-mcp-data-'));
    tempDirs.push(dataDir);
    const previousDataDir = process.env.CONTRACTOR_DATA_DIR;
    process.env.CONTRACTOR_DATA_DIR = dataDir;

    try {
      const services = await createDefaultContractorServices();
      assert.deepEqual(services.listClients(), []);
      assert.deepEqual(services.listProjects(), {
        projects: [],
        activeProjectId: null,
      });
      assert.ok(existsSync(join(dataDir, 'clients.json')));
      assert.ok(existsSync(join(dataDir, 'projects', '_index.json')));
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.CONTRACTOR_DATA_DIR;
      } else {
        process.env.CONTRACTOR_DATA_DIR = previousDataDir;
      }
    }
  });
});

describe('Contractor MCP config installer', () => {
  it('merges only the contractor server and preserves existing servers', () => {
    const original = {
      theme: 'dark',
      mcpServers: {
        existing: {
          command: 'existing-command',
          env: { EXISTING_SECRET: 'do-not-print-this' },
        },
        contractor: { command: 'old-command' },
      },
    };
    const entry = {
      command: '/usr/bin/node',
      args: ['/repo/src/server.mjs', '--mcp'],
    };

    const merged = mergeMcpServerConfig(original, entry);

    assert.notStrictEqual(merged, original);
    assert.deepEqual(merged, {
      theme: 'dark',
      mcpServers: {
        existing: original.mcpServers.existing,
        contractor: entry,
      },
    });
    assert.deepEqual(original.mcpServers.contractor, { command: 'old-command' });
  });

  it('supports side-effect-free dry runs for Codex, Claude, and Antigravity', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'contractor-mcp-installer-'));
    tempDirs.push(homeDir);
    const claudePath = join(homeDir, '.claude.json');
    const antigravityPath = join(homeDir, '.gemini', 'antigravity', 'mcp_config.json');
    mkdirSync(join(homeDir, '.gemini', 'antigravity'), { recursive: true });
    writeFileSync(claudePath, JSON.stringify({ mcpServers: { existing: { command: 'keep' } } }, null, 2));
    writeFileSync(antigravityPath, JSON.stringify({ mcpServers: { gemini: { command: 'keep' } } }, null, 2));
    const beforeClaude = readFileSync(claudePath, 'utf8');
    const beforeAntigravity = readFileSync(antigravityPath, 'utf8');
    const commands = [];

    const report = await installMcpConfig({
      homeDir,
      serverPath: '/repo/src/server.mjs',
      nodePath: '/usr/bin/node',
      dryRun: true,
      runCommand(command, args) {
        commands.push([command, args]);
        return { status: 0 };
      },
    });

    assert.deepEqual(commands, []);
    assert.equal(readFileSync(claudePath, 'utf8'), beforeClaude);
    assert.equal(readFileSync(antigravityPath, 'utf8'), beforeAntigravity);
    assert.equal(report.dryRun, true);
    assert.deepEqual(report.codex.command, [
      'codex',
      'mcp',
      'add',
      'contractor',
      '--',
      '/usr/bin/node',
      '/repo/src/server.mjs',
      '--mcp',
    ]);
    assert.ok(report.claude.some(item => item.path === claudePath && item.action === 'would-update'));
    assert.equal(report.antigravity.action, 'would-update');
    assert.doesNotMatch(JSON.stringify(report), /do-not-print-this/);
    assert.equal(existsSync(`${claudePath}.backup-20260615T120000Z`), false);
  });

  it('backs up JSON configs, preserves other servers, and invokes Codex', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'contractor-mcp-installer-'));
    tempDirs.push(homeDir);
    const claudePath = join(homeDir, '.claude.json');
    const antigravityPath = join(homeDir, '.gemini', 'antigravity', 'mcp_config.json');
    mkdirSync(join(homeDir, '.gemini', 'antigravity'), { recursive: true });
    writeFileSync(claudePath, JSON.stringify({ mcpServers: { existing: { command: 'keep-claude' } } }, null, 2));
    writeFileSync(antigravityPath, JSON.stringify({ mcpServers: { gemini: { command: 'keep-gemini' } } }, null, 2));
    const commands = [];

    const report = await installMcpConfig({
      homeDir,
      serverPath: '/repo/src/server.mjs',
      nodePath: '/usr/bin/node',
      now: new Date('2026-06-15T12:00:00.000Z'),
      runCommand(command, args) {
        commands.push([command, args]);
        return { status: 0, stdout: 'registered', stderr: '' };
      },
    });

    assert.deepEqual(commands, [[
      'codex',
      ['mcp', 'add', 'contractor', '--', '/usr/bin/node', '/repo/src/server.mjs', '--mcp'],
    ]]);
    assert.equal(report.codex.action, 'updated');

    const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
    const antigravity = JSON.parse(readFileSync(antigravityPath, 'utf8'));
    assert.deepEqual(claude.mcpServers.existing, { command: 'keep-claude' });
    assert.deepEqual(antigravity.mcpServers.gemini, { command: 'keep-gemini' });
    assert.deepEqual(claude.mcpServers.contractor, {
      command: '/usr/bin/node',
      args: ['/repo/src/server.mjs', '--mcp'],
    });
    assert.deepEqual(antigravity.mcpServers.contractor, claude.mcpServers.contractor);
    assert.ok(existsSync(`${claudePath}.backup-20260615T120000Z`));
    assert.ok(existsSync(`${antigravityPath}.backup-20260615T120000Z`));
  });

  it('registers a packaged executable with the --mcp argument', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'contractor-mcp-installer-'));
    tempDirs.push(homeDir);
    const commands = [];
    const executablePath = join(homeDir, 'Contractor.AppImage');

    const report = await installMcpConfig({
      homeDir,
      executablePath,
      dryRun: true,
      runCommand(command, args) {
        commands.push([command, args]);
        return { status: 0 };
      },
    });

    assert.deepEqual(commands, []);
    assert.deepEqual(report.codex.command, [
      'codex', 'mcp', 'add', 'contractor', '--', executablePath, '--mcp',
    ]);
  });
});
