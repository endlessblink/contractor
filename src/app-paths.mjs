import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, statSync } from 'fs';
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

  // Migrate data from old Inno Setup location (%APPDATA%\Contractor) if it exists
  if (IS_PKG && process.platform === 'win32') {
    const oldDir = process.env.APPDATA ? join(process.env.APPDATA, 'Contractor') : null;
    if (oldDir && oldDir !== USER_DATA_DIR && existsSync(oldDir)) {
      const filesToMigrate = [
        'user-profile.json', 'clients.json',
        join('knowledge', 'clauses-db.json'), join('knowledge', 'learned-context.json'),
        join('projects', '_index.json'),
      ];
      for (const rel of filesToMigrate) {
        const src = join(oldDir, rel);
        const dest = join(USER_DATA_DIR, rel);
        if (existsSync(src) && !existsSync(dest)) {
          try { copyFileSync(src, dest); console.log('Migrated: ' + rel); } catch {}
        }
      }
      // Migrate project subdirectories
      try {
        const oldProjects = join(oldDir, 'projects');
        if (existsSync(oldProjects)) {
          for (const name of readdirSync(oldProjects)) {
            const srcPath = join(oldProjects, name);
            const destPath = join(USER_DATA_DIR, 'projects', name);
            if (!existsSync(destPath)) {
              try {
                if (statSync(srcPath).isDirectory()) {
                  mkdirSync(destPath, { recursive: true });
                  for (const f of readdirSync(srcPath)) { copyFileSync(join(srcPath, f), join(destPath, f)); }
                } else { copyFileSync(srcPath, destPath); }
              } catch {}
            }
          }
        }
      } catch {}
      // Migrate references
      try {
        const oldRefs = join(oldDir, 'references');
        if (existsSync(oldRefs)) {
          for (const name of readdirSync(oldRefs)) {
            const src = join(oldRefs, name);
            const dest = join(USER_DATA_DIR, 'references', name);
            if (!existsSync(dest) && statSync(src).isFile()) {
              try { copyFileSync(src, dest); } catch {}
            }
          }
        }
      } catch {}
    }
  }

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
