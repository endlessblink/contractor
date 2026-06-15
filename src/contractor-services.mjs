import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { generateDocument as renderDocument } from './generate-quote.mjs';

const DOCUMENT_TYPE_NAMES = {
  quote: 'הצעת מחיר',
  contract: 'חוזה',
  order: 'הזמנת עבודה',
  workOrder: 'הזמנת עבודה',
  cv: 'קורות חיים',
};

function clone(value) {
  return structuredClone(value);
}

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== '';
}

function fillMissingFields(deterministic, fallback) {
  const merged = { ...(fallback || {}) };
  for (const [key, value] of Object.entries(deterministic || {})) {
    merged[key] = hasMeaningfulValue(value) ? value : merged[key];
  }
  return merged;
}

function assertSafeId(id, label = 'ID') {
  if (!id || typeof id !== 'string' || id.includes('..') || /[/\\]/.test(id)) {
    throw new Error(`Invalid ${label}`);
  }
}

function slugify(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0590-\u05ff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `project-${Date.now()}`;
}

function atomicWriteJson(path, data) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
}

function normalizeDocType(docType) {
  if (docType === 'order') return 'order';
  if (docType === 'workOrder') return 'order';
  return ['quote', 'contract', 'cv'].includes(docType) ? docType : 'quote';
}

function mapFormStateToDocument(formState) {
  const docType = normalizeDocType(formState.docType);
  const standardInstallments = {
    two: [
      { percentage: 35, description: 'מקדמה בתחילת עבודה' },
      { percentage: 65, description: 'תשלום סופי עם סיום הפרויקט' },
    ],
    three: [
      { percentage: 40, description: 'מקדמה בתחילת עבודה' },
      { percentage: 30, description: 'תשלום שני באמצע הפרויקט' },
      { percentage: 30, description: 'תשלום סופי עם סיום הפרויקט' },
    ],
  };
  const explicitInstallments = Array.isArray(formState.paymentInstallments)
    ? formState.paymentInstallments
      .filter(item => Number(item?.percentage) > 0)
      .map(item => ({
        percentage: Number(item.percentage),
        description: String(item.description || '').trim() || 'תשלום',
      }))
    : [];
  const customPercentages = Array.isArray(formState.customInstallments)
    ? formState.customInstallments.filter(value => Number(value) > 0)
    : [];
  const installments = explicitInstallments.length
    ? explicitInstallments
    : formState.paymentStructure === 'custom'
      ? customPercentages.map((percentage, index) => ({
        percentage: Number(percentage),
        description: `תשלום ${index + 1}`,
      }))
      : standardInstallments[formState.paymentStructure || 'two'] || [];
  const notes = [formState.notes, formState.paymentNotes].filter(Boolean).join('\n');

  return {
    clientName: formState.clientName || '',
    clientCompany: formState.clientCompany || '',
    documentType: docType === 'order' ? 'workOrder' : docType,
    projectDescription: formState.projectDescription || '',
    serviceDetails: formState.serviceDetails || '',
    cvData: formState.cvData || null,
    pricingItems: (formState.pricingItems || formState.pricing || []).map(item => ({
      description: item.desc || item.description || '',
      quantity: Number(item.qty ?? item.quantity ?? 1),
      unitPrice: Number(item.price ?? item.unitPrice ?? 0),
      option: item.option || '',
    })),
    paymentTerms: {
      type: formState.paymentStructure || 'two',
      installments,
    },
    timeline: formState.timeline || '',
    generalNotes: notes,
    serviceType: formState.serviceType || '',
    selectedClauses: formState.selectedClauses || null,
    clauseEdits: formState.clauseEdits || {},
    date: formState.documentDate || null,
  };
}

export function createContractorServices({
  dataDir,
  userProfile = {},
  openGeneratedDocument = false,
  markdownParser,
  aiImportFallback,
} = {}) {
  if (!dataDir) throw new Error('dataDir is required');

  const projectsDir = join(dataDir, 'projects');
  const outputDir = join(dataDir, 'output');
  const clientsPath = join(dataDir, 'clients.json');
  const indexPath = join(projectsDir, '_index.json');
  const writeLockPath = join(dataDir, '.write-lock');
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  if (!existsSync(clientsPath)) atomicWriteJson(clientsPath, { clients: [] });
  if (!existsSync(indexPath)) atomicWriteJson(indexPath, { projects: [], activeProjectId: null });

  function acquireWriteLock(timeoutMs = 5000) {
    const start = Date.now();
    while (true) {
      try {
        mkdirSync(writeLockPath);
        return () => rmSync(writeLockPath, { recursive: true, force: true });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() - start >= timeoutMs) throw new Error('Timed out waiting for Contractor data lock');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
      }
    }
  }

  let writeQueue = Promise.resolve();
  const serializeWrite = operation => {
    const run = async () => {
      const release = acquireWriteLock();
      try {
        return await operation();
      } finally {
        release();
      }
    };
    const pending = writeQueue.then(run, run);
    writeQueue = pending.catch(() => {});
    return pending;
  };

  function readIndex() {
    try {
      return JSON.parse(readFileSync(indexPath, 'utf8'));
    } catch {
      return { projects: [], activeProjectId: null };
    }
  }

  function projectPath(projectId) {
    assertSafeId(projectId, 'project ID');
    return join(projectsDir, projectId);
  }

  function readProject(projectId) {
    const path = join(projectPath(projectId), 'project.json');
    if (!existsSync(path)) throw new Error(`Project not found: ${projectId}`);
    const project = JSON.parse(readFileSync(path, 'utf8'));
    if (project.formState && !project.formStates) {
      const type = normalizeDocType(project.formState.docType);
      project.formStates = { [type]: project.formState };
      delete project.formState;
    }
    project.formStates ||= {};
    project.activeDocType ||= 'quote';
    return project;
  }

  function writeProject(project) {
    const dir = projectPath(project.id);
    mkdirSync(join(dir, 'output'), { recursive: true });
    mkdirSync(join(dir, 'uploads'), { recursive: true });
    mkdirSync(join(dir, 'imports'), { recursive: true });
    atomicWriteJson(join(dir, 'project.json'), project);
  }

  function uniqueProjectId(name) {
    const base = slugify(name);
    let id = base;
    let suffix = 2;
    while (existsSync(join(projectsDir, id))) id = `${base}-${suffix++}`;
    return id;
  }

  function updateIndexEntry(project) {
    const index = readIndex();
    let entry = index.projects.find(item => item.id === project.id);
    if (!entry) {
      entry = { id: project.id, createdAt: project.createdAt };
      index.projects.push(entry);
    }
    entry.name = project.name;
    if (project.clientId) entry.clientId = project.clientId;
    entry.clientName = project.formStates?.[project.activeDocType]?.clientName || entry.clientName || '';
    entry.docType = project.activeDocType || '';
    entry.docTypes = Object.keys(project.formStates || {});
    entry.lastModified = new Date().toISOString();
    const generatedDir = join(projectsDir, project.id, 'output');
    entry.docCount = existsSync(generatedDir)
      ? readdirSync(generatedDir).filter(name => !name.startsWith('.')).length
      : 0;
    atomicWriteJson(indexPath, index);
  }

  function readClients() {
    try {
      return JSON.parse(readFileSync(clientsPath, 'utf8')).clients || [];
    } catch {
      return [];
    }
  }

  // Find an existing client by (fuzzy) name or create a new one. Mirrors the
  // matching used by the HTTP /api/clients/match endpoint so imports reuse
  // clients instead of duplicating them.
  async function findOrCreateClient({ name, company } = {}) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    return serializeWrite(() => {
      const data = (() => {
        try { return JSON.parse(readFileSync(clientsPath, 'utf8')); } catch { return { clients: [] }; }
      })();
      data.clients ||= [];
      const normalized = trimmed.toLowerCase();
      const existing = data.clients.find(client => {
        const clientName = String(client.name || '').trim().toLowerCase();
        return clientName && (clientName === normalized
          || clientName.includes(normalized) || normalized.includes(clientName));
      });
      if (existing) return clone(existing);

      const base = slugify(trimmed).replace(/^project-/, 'client-') || `client-${Date.now()}`;
      let id = base;
      let suffix = 2;
      while (data.clients.some(client => client.id === id)) id = `${base}-${suffix++}`;
      const now = new Date().toISOString();
      const client = {
        id,
        name: trimmed,
        company: String(company || '').trim(),
        contactName: '',
        email: '',
        phone: '',
        notes: '',
        defaultPaymentStructure: '',
        createdAt: now,
        updatedAt: now,
      };
      data.clients.push(client);
      atomicWriteJson(clientsPath, data);
      return clone(client);
    });
  }

  async function createProject({ name, clientId } = {}) {
    if (!String(name || '').trim()) throw new Error('Project name is required');
    return serializeWrite(() => {
      const now = new Date().toISOString();
      const project = {
        id: uniqueProjectId(name),
        name: String(name).trim(),
        createdAt: now,
        chatHistory: [],
        formStates: {},
        activeDocType: 'quote',
      };
      if (clientId) project.clientId = clientId;
      writeProject(project);
      updateIndexEntry(project);
      return clone(project);
    });
  }

  async function upsertDocumentDraft({ projectId, docType, formState } = {}) {
    if (!formState || typeof formState !== 'object' || Array.isArray(formState)) {
      throw new Error('formState must be an object');
    }
    return serializeWrite(() => {
      const project = readProject(projectId);
      const type = normalizeDocType(docType || formState.docType || project.activeDocType);
      project.formStates[type] = { ...clone(formState), docType: type };
      project.activeDocType = type;
      project.updatedAt = new Date().toISOString();
      writeProject(project);
      updateIndexEntry(project);
      return { projectId, docType: type, formState: clone(project.formStates[type]) };
    });
  }

  async function importMarkdown({
    markdown,
    filePath,
    filename,
    projectId,
    useAiFallback = true,
  } = {}) {
    let source = markdown;
    if (source == null && filePath) source = readFileSync(filePath, 'utf8');
    if (typeof source !== 'string' || !source.trim()) throw new Error('Markdown content is required');
    const parser = markdownParser || (await import('./markdown-import.mjs')).parseMarkdownImport;
    let parsed = await parser(source, { sourceName: filename || (filePath ? basename(filePath) : 'import.md') });
    parsed = {
      ...parsed,
      formState: parsed.formState || parsed.formData,
      confidence: typeof parsed.confidence === 'number'
        ? parsed.confidence
        : parsed.confidence?.overall ?? 0,
      unresolvedFields: parsed.unresolvedFields
        || (parsed.warnings || []).map(warning => warning.field).filter(Boolean),
    };
    if (useAiFallback && parsed.unresolvedFields?.length && aiImportFallback) {
      const fallback = await aiImportFallback({ markdown: source, parsed });
      parsed = {
        ...parsed,
        ...fallback,
        formState: fillMissingFields(parsed.formState, fallback.formState),
        warnings: [...(parsed.warnings || []), ...(fallback.warnings || [])],
      };
    }
    parsed.formState = {
      ...parsed.formState,
      importedUnknownSections: parsed.unknownSections || [],
    };

    let targetId = projectId;
    let linkedClientId;
    if (!targetId) {
      // File the imported quote under a client when the Markdown has a real
      // recipient. Placeholder/empty recipients stay client-less (assign later).
      const recipientName = String(parsed.formState?.clientName || '').trim();
      if (recipientName) {
        const client = await findOrCreateClient({
          name: recipientName,
          company: parsed.formState?.clientCompany,
        });
        linkedClientId = client?.id;
      }
      const project = await createProject({
        name: parsed.formState?.projectDescription || parsed.title || 'מסמך מיובא',
        clientId: linkedClientId,
      });
      targetId = project.id;
    }
    const draft = await upsertDocumentDraft({
      projectId: targetId,
      docType: parsed.documentType || parsed.formState?.docType,
      formState: parsed.formState,
    });

    const hash = createHash('sha256').update(source).digest('hex');
    await serializeWrite(() => {
      const project = readProject(targetId);
      const importsDir = join(projectPath(targetId), 'imports');
      mkdirSync(importsDir, { recursive: true });
      const safeName = basename(filename || (filePath ? basename(filePath) : 'import.md'));
      const storedName = `${Date.now()}-${safeName.replace(/[^\w\u0590-\u05ff.-]/g, '_')}`;
      const storedPath = join(importsDir, storedName);
      if (filePath) copyFileSync(filePath, storedPath);
      else writeFileSync(storedPath, source, 'utf8');
      project.imports ||= [];
      project.imports.push({
        filename: safeName,
        storedName,
        sha256: hash,
        importedAt: new Date().toISOString(),
        documentType: draft.docType,
        warnings: parsed.warnings || [],
      });
      writeProject(project);
      return storedPath;
    });

    return {
      projectId: targetId,
      documentType: draft.docType,
      formState: draft.formState,
      clientId: linkedClientId || readProject(targetId).clientId || null,
      confidence: parsed.confidence,
      warnings: parsed.warnings || [],
      unresolvedFields: parsed.unresolvedFields || [],
      source: { filename: filename || (filePath ? basename(filePath) : 'import.md'), sha256: hash },
    };
  }

  async function generateDocument({ projectId, docType, formState } = {}) {
    const project = projectId ? readProject(projectId) : null;
    const type = normalizeDocType(docType || formState?.docType || project?.activeDocType);
    const draft = formState || project?.formStates?.[type];
    if (!draft) throw new Error(`Draft not found for document type: ${type}`);
    const data = mapFormStateToDocument({ ...draft, docType: type });
    const currentUserProfile = typeof userProfile === 'function' ? userProfile() : userProfile;
    const buffer = await renderDocument({ ...data, userProfile: currentUserProfile });
    const saveDir = projectId ? join(projectPath(projectId), 'output') : outputDir;
    mkdirSync(saveDir, { recursive: true });

    const typeName = DOCUMENT_TYPE_NAMES[type] || 'מסמך';
    const description = String(data.projectDescription || '').split(/[.\n,]/)[0].trim().slice(0, 40);
    const clientName = String(data.clientName || '').trim();
    const date = draft.documentDate ? new Date(`${draft.documentDate}T00:00:00`) : new Date();
    const dateText = `${date.getDate()}.${date.getMonth() + 1}.${String(date.getFullYear()).slice(-2)}`;
    const sequence = readdirSync(saveDir).filter(name => name.startsWith(typeName) && name.endsWith('.docx')).length + 1;
    const filename = [typeName, description, clientName && `עבור ${clientName}`, dateText, sequence]
      .filter(Boolean)
      .join(' - ')
      .replace(/[^\w\u0590-\u05ff\s.\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim() + '.docx';
    const outputPath = join(saveDir, filename);
    writeFileSync(outputPath, buffer);

    if (projectId) {
      await serializeWrite(() => {
        const current = readProject(projectId);
        updateIndexEntry(current);
      });
    }
    if (openGeneratedDocument) {
      const { execFile } = await import('node:child_process');
      execFile('xdg-open', [outputPath], () => {});
    }
    return { projectId: projectId || null, docType: type, filename, path: outputPath, bytes: buffer.length };
  }

  return {
    listClients() {
      return JSON.parse(readFileSync(clientsPath, 'utf8')).clients || [];
    },
    listProjects() {
      return clone(readIndex());
    },
    getProject({ projectId } = {}) {
      return clone(readProject(projectId));
    },
    createProject,
    findOrCreateClient,
    upsertDocumentDraft,
    importMarkdown,
    generateDocument,
  };
}

export { mapFormStateToDocument };
