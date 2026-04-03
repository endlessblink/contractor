#!/usr/bin/env node
import { build } from 'esbuild';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync } from 'fs';

// Read version from updater.mjs
const updaterSrc = readFileSync('src/updater.mjs', 'utf-8');
const versionMatch = updaterSrc.match(/CURRENT_VERSION\s*=\s*'([^']+)'/);
const VERSION = versionMatch ? versionMatch[1] : 'unknown';
console.log(`Version: ${VERSION}`);

const args = process.argv.slice(2);
const idx = args.indexOf('--target');
const targetFlag = idx !== -1 ? args[idx + 1] : 'all';

const targetMap = {
  win: 'node20-win-x64',
  mac: 'node20-macos-arm64,node20-macos-x64',
  linux: 'node20-linux-x64',
  all: 'node20-linux-x64,node20-macos-arm64,node20-macos-x64,node20-win-x64',
};
const targets = (targetMap[targetFlag] || targetMap.all).split(',');

console.log('📦 Step 1: Bundling with esbuild...');
mkdirSync('dist', { recursive: true });
mkdirSync('dist/executables', { recursive: true });

await build({
  entryPoints: ['src/server.mjs'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/bundle.cjs',
  external: [
    'puppeteer', 'puppeteer-core', 'chrome-finder',
    'mammoth', 'docx', 'pdf-parse', 'open',
  ],
  define: {
    'import.meta.url': 'importMetaUrl',
  },
  banner: {
    js: 'const importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
});

console.log('✅ dist/bundle.cjs created');
console.log(`\n📦 Step 2: Packaging with @yao-pkg/pkg...`);

for (const t of targets) {
  const outName = `contractor-${t.replace('node20-', '')}-v${VERSION}`;
  console.log(`  → ${outName}`);
  execSync(
    `npx @yao-pkg/pkg dist/bundle.cjs --target ${t} --output dist/executables/${outName} --config package.json`,
    { stdio: 'inherit' }
  );
}

console.log('\n✅ Done! Executables in dist/executables/');
