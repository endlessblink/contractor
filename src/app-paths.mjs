import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Detect if running inside a pkg binary
export const IS_PKG = typeof process.pkg !== 'undefined';

// App directory (where executable lives, or project root in dev)
export const APP_DIR = IS_PKG
  ? dirname(process.execPath)
  : join(__dirname, '..');

// User data directory — always writable, persists across updates
export const USER_DATA_DIR = IS_PKG
  ? join(homedir(), '.contractor')
  : join(APP_DIR, 'data');

export function initUserDataDir() {
  const dirs = ['knowledge', 'output', 'uploads', 'projects', 'references'];
  for (const d of dirs) mkdirSync(join(USER_DATA_DIR, d), { recursive: true });

  const seeds = [
    {
      src: join(APP_DIR, 'knowledge', 'clauses-db.json'),
      dest: join(USER_DATA_DIR, 'knowledge', 'clauses-db.json'),
    },
    {
      src: join(APP_DIR, 'data', 'user-profile.example.json'),
      dest: join(USER_DATA_DIR, 'user-profile.json'),
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
