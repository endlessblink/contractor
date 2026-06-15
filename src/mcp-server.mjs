import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const SERVER_INFO = {
  name: 'contractor',
  version: '1.0.0',
};
const documentTypeSchema = z.enum(['quote', 'contract', 'order', 'workOrder', 'cv']);

function jsonResult(tool, data) {
  const payload = { ok: true, tool, data };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function errorResult(tool, error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.code)
    ? error.code
    : 'CONTRACTOR_SERVICE_ERROR';
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message
    : 'Contractor service failed';
  const payload = { ok: false, tool, error: { code, message } };

  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function registerServiceTool(server, services, name, config, serviceName) {
  server.registerTool(name, config, async args => {
    try {
      if (typeof services[serviceName] !== 'function') {
        const error = new Error(`Contractor service "${serviceName}" is unavailable`);
        error.code = 'SERVICE_UNAVAILABLE';
        throw error;
      }
      const data = await services[serviceName](args);
      return jsonResult(name, data);
    } catch (error) {
      return errorResult(name, error);
    }
  });
}

export function createContractorMcpServer({ services, serverInfo = SERVER_INFO } = {}) {
  if (!services || typeof services !== 'object') {
    throw new TypeError('Contractor services are required');
  }

  const server = new McpServer(serverInfo);

  registerServiceTool(server, services, 'contractor_list_clients', {
    title: 'List Contractor Clients',
    description: 'List Contractor clients.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, 'listClients');

  registerServiceTool(server, services, 'contractor_list_projects', {
    title: 'List Contractor Projects',
    description: 'List Contractor projects.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, 'listProjects');

  registerServiceTool(server, services, 'contractor_get_project', {
    title: 'Get Contractor Project',
    description: 'Return a Contractor project including its document drafts.',
    inputSchema: {
      projectId: z.string().trim().min(1),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, 'getProject');

  registerServiceTool(server, services, 'contractor_import_markdown', {
    title: 'Import Markdown',
    description: 'Import Markdown into a Contractor project document draft.',
    inputSchema: {
      markdown: z.string().min(1),
      filename: z.string().trim().min(1).optional(),
      projectId: z.string().trim().min(1).optional(),
      useAiFallback: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, 'importMarkdown');

  registerServiceTool(server, services, 'contractor_upsert_document_draft', {
    title: 'Upsert Document Draft',
    description: 'Create or replace a document draft in a Contractor project.',
    inputSchema: {
      projectId: z.string().trim().min(1),
      docType: documentTypeSchema,
      formState: z.record(z.string(), z.unknown()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, 'upsertDocumentDraft');

  registerServiceTool(server, services, 'contractor_generate_document', {
    title: 'Generate Contractor Document',
    description: 'Generate a document from a saved Contractor project draft.',
    inputSchema: {
      projectId: z.string().trim().min(1),
      docType: documentTypeSchema,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, 'generateDocument');

  return server;
}

export async function createDefaultContractorServices() {
  const { createContractorServices } = await import('./contractor-services.mjs');
  const { USER_DATA_DIR, initUserDataDir } = await import('./app-paths.mjs');
  initUserDataDir();

  return createContractorServices({
    dataDir: USER_DATA_DIR,
    openGeneratedDocument: false,
    userProfile() {
      try {
        return JSON.parse(readFileSync(join(USER_DATA_DIR, 'user-profile.json'), 'utf8'));
      } catch {
        return {};
      }
    },
  });
}

export async function runContractorMcpServer({
  services,
  transport = new StdioServerTransport(),
  serverInfo,
} = {}) {
  const resolvedServices = services || await createDefaultContractorServices();
  const server = createContractorMcpServer({ services: resolvedServices, serverInfo });
  await server.connect(transport);
  if (transport instanceof StdioServerTransport) {
    process.stdin.resume();
  }
  return server;
}
