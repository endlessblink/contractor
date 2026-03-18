import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'fs';
import { join } from 'path';

// For single-user mode, all paths resolve to the same data/ directory
const DATA_ROOT = join(import.meta.dirname, '..', 'data');

export function getUserProfile(userId = 'default') {
  const defaults = {
    name: '', nameEn: '', company: '', companyHe: '',
    title: '', titleEn: '', email: '', website: '', phone: '',
    logoPath: '', language: 'he', currency: '₪', setupComplete: false,
  };
  try {
    const raw = readFileSync(join(DATA_ROOT, 'user-profile.json'), 'utf-8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

export function saveUserProfile(profile, userId = 'default') {
  mkdirSync(DATA_ROOT, { recursive: true });
  writeFileSync(join(DATA_ROOT, 'user-profile.json'), JSON.stringify(profile, null, 2), 'utf-8');
}

export function getClausesDb(userId = 'default') {
  // Check new location first, fall back to old
  const newPath = join(DATA_ROOT, 'knowledge', 'clauses-db.json');
  const oldPath = join(DATA_ROOT, '..', 'knowledge', 'clauses-db.json');
  for (const p of [newPath, oldPath]) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {}
  }
  return null;
}

export function saveClausesDb(db, userId = 'default') {
  const dir = join(DATA_ROOT, 'knowledge');
  mkdirSync(dir, { recursive: true });
  // Save to old location too for backward compat (where KNOWLEDGE_DIR points)
  const oldPath = join(DATA_ROOT, '..', 'knowledge', 'clauses-db.json');
  const newPath = join(dir, 'clauses-db.json');
  const json = JSON.stringify(db, null, 2);
  try { writeFileSync(oldPath, json, 'utf-8'); } catch {}
  try { writeFileSync(newPath, json, 'utf-8'); } catch {}
}

export function getDocumentTypes(userId = 'default') {
  try {
    return JSON.parse(readFileSync(join(DATA_ROOT, 'knowledge', 'document-types.json'), 'utf-8'));
  } catch {
    return { version: 1, types: [] };
  }
}

export function saveDocumentTypes(data, userId = 'default') {
  const dir = join(DATA_ROOT, 'knowledge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'document-types.json'), JSON.stringify(data, null, 2), 'utf-8');
}

export function listReferences(userId = 'default') {
  const results = [];
  const refsDir = join(DATA_ROOT, 'references');
  try {
    for (const name of readdirSync(refsDir)) {
      const ext = name.split('.').pop().toLowerCase();
      if (!['docx', 'doc', 'pdf'].includes(ext)) continue;
      const stat = statSync(join(refsDir, name));
      results.push({ name, source: 'uploaded', size: stat.size, modified: stat.mtime.toISOString() });
    }
  } catch {}
  return results;
}

export function listPendingExtractions(userId = 'default') {
  const dir = join(DATA_ROOT, 'knowledge', 'pending-extractions');
  const results = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const data = JSON.parse(readFileSync(join(dir, name), 'utf-8'));
      results.push({ id: data.id, createdAt: data.createdAt, status: data.status, sourceFiles: data.sourceFiles, summary: data.summary });
    }
  } catch {}
  return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Auth middleware placeholder for SaaS-ready architecture
export function authMiddleware(req, res, next) {
  // Single-user mode: always 'default'
  req.userId = 'default';
  next();
}
