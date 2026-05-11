import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { SNAPSHOT_DIR, USER_DATA_DIR } from './app-paths.mjs';

const DEFAULT_SKILLS = [
  'hebrew-document-generator.md',
  'israeli-cv-builder.md',
];

const SKILL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const DEFAULT_SKILLS_DIR = join(SNAPSHOT_DIR, 'skills');
export const USER_SKILLS_DIR = join(USER_DATA_DIR, 'skills');

export function initRuntimeSkills() {
  mkdirSync(USER_SKILLS_DIR, { recursive: true });

  for (const filename of DEFAULT_SKILLS) {
    const src = join(DEFAULT_SKILLS_DIR, filename);
    const dest = join(USER_SKILLS_DIR, filename);
    if (!existsSync(dest) && existsSync(src)) {
      copyFileSync(src, dest);
    }
  }

  return loadRuntimeSkills();
}

export function listRuntimeSkillFiles() {
  try {
    return readdirSync(USER_SKILLS_DIR)
      .filter(name => name.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

export function parseRuntimeSkill(markdown, fallbackId = '') {
  const idFromFile = fallbackId.replace(/\.md$/i, '');
  const skill = {
    id: idFromFile,
    name: idFromFile,
    appliesTo: ['all'],
    version: null,
    body: markdown || '',
    raw: markdown || '',
  };

  const match = String(markdown || '').match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return skill;

  const frontmatter = match[1];
  skill.body = String(markdown || '').slice(match[0].length);

  const lines = frontmatter.split('\n');
  let currentKey = null;
  for (const line of lines) {
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyValue) {
      currentKey = keyValue[1];
      const value = keyValue[2].trim();
      if (currentKey === 'id' && value) skill.id = value;
      if (currentKey === 'name' && value) skill.name = value;
      if (currentKey === 'version' && value) skill.version = value;
      if (currentKey === 'appliesTo') skill.appliesTo = value ? value.split(',').map(v => v.trim()).filter(Boolean) : [];
      continue;
    }

    const listItem = line.match(/^\s*-\s*(.+)$/);
    if (listItem && currentKey === 'appliesTo') {
      skill.appliesTo.push(listItem[1].trim());
    }
  }

  if (!Array.isArray(skill.appliesTo) || skill.appliesTo.length === 0) skill.appliesTo = ['all'];
  return skill;
}

export function loadRuntimeSkills() {
  return listRuntimeSkillFiles().map(filename => {
    const raw = readFileSync(join(USER_SKILLS_DIR, filename), 'utf-8');
    return {
      ...parseRuntimeSkill(raw, filename),
      filename,
      path: join(USER_SKILLS_DIR, filename),
    };
  });
}

export function loadRuntimeSkill(id) {
  if (!SKILL_ID_RE.test(id || '')) return null;
  const filename = `${id}.md`;
  const filePath = join(USER_SKILLS_DIR, filename);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  return {
    ...parseRuntimeSkill(raw, filename),
    filename,
    path: filePath,
  };
}

export function saveRuntimeSkill(id, markdown) {
  if (!SKILL_ID_RE.test(id || '')) {
    throw new Error('Invalid skill id');
  }
  mkdirSync(USER_SKILLS_DIR, { recursive: true });
  const filename = `${id}.md`;
  const safeName = basename(filename);
  if (safeName !== filename) throw new Error('Invalid skill filename');
  writeFileSync(join(USER_SKILLS_DIR, filename), String(markdown || ''), 'utf-8');
  return loadRuntimeSkill(id);
}

export function buildRuntimeSkillsPromptSection({ documentType = null, includeAll = true } = {}) {
  const skills = loadRuntimeSkills().filter(skill => {
    if (includeAll) return true;
    if (!documentType) return skill.appliesTo.includes('all');
    return skill.appliesTo.includes('all') || skill.appliesTo.includes(documentType);
  });

  if (skills.length === 0) return '';

  let section = '\n\n## Runtime Document Skills\n';
  section += 'The following editable Markdown skills are loaded from the app skills folder. Apply them only when relevant to the requested document type.\n';

  for (const skill of skills) {
    section += `\n### ${skill.name || skill.id} (${skill.id})\n`;
    section += `Applies to: ${skill.appliesTo.join(', ')}\n\n`;
    section += `${skill.body.trim()}\n`;
  }

  return section;
}
