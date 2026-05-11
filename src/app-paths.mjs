import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Detect if running inside a pkg binary
export const IS_PKG = typeof process.pkg !== 'undefined';

// Snapshot directory — where bundled read-only assets live (inside pkg snapshot or project root in dev)
export const SNAPSHOT_DIR = join(__dirname, '..');

// App directory (where executable lives, or project root in dev)
export const APP_DIR = IS_PKG
  ? dirname(process.execPath)
  : SNAPSHOT_DIR;

// User data directory — always writable, persists across updates
// CONTRACTOR_DATA_DIR env var allows override for testing
export const USER_DATA_DIR = process.env.CONTRACTOR_DATA_DIR || (IS_PKG
  ? join(homedir(), '.contractor')
  : join(APP_DIR, 'data'));

export function initUserDataDir() {
  const dirs = ['knowledge', 'output', 'uploads', 'projects', 'references', 'skills'];
  for (const d of dirs) mkdirSync(join(USER_DATA_DIR, d), { recursive: true });

  const seeds = [
    {
      src: join(SNAPSHOT_DIR, 'knowledge', 'clauses-db.sample.json'),
      dest: join(USER_DATA_DIR, 'knowledge', 'clauses-db.json'),
    },
    {
      src: join(SNAPSHOT_DIR, 'data', 'user-profile.example.json'),
      dest: join(USER_DATA_DIR, 'user-profile.json'),
    },
    {
      src: join(SNAPSHOT_DIR, 'skills', 'hebrew-document-generator.md'),
      dest: join(USER_DATA_DIR, 'skills', 'hebrew-document-generator.md'),
    },
    {
      src: join(SNAPSHOT_DIR, 'skills', 'israeli-cv-builder.md'),
      dest: join(USER_DATA_DIR, 'skills', 'israeli-cv-builder.md'),
    },
  ];

  for (const { src, dest } of seeds) {
    if (!existsSync(dest)) {
      try {
        copyFileSync(src, dest);
      } catch {
        if (dest.endsWith('user-profile.json')) {
          writeFileSync(dest, JSON.stringify({
            name: '', nameEn: '', company: '', companyHe: '',
            title: '', titleEn: '', email: '', website: '', phone: '',
            logoPath: '', language: 'he', currency: '₪', setupComplete: false,
            aiProvider: 'anthropic', aiModel: 'claude-haiku-4-5-20251001',
            aiApiKey: '', useClaudeOAuth: false,
          }, null, 2));
        }
      }
    }
  }
}

export function resolveAsset(...parts) {
  return join(APP_DIR, ...parts);
}

export function resolveData(...parts) {
  return join(USER_DATA_DIR, ...parts);
}
