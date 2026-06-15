#!/usr/bin/env node
import { build } from 'esbuild';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';

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
    `npx @yao-pkg/pkg dist/bundle.cjs --target ${t} --output dist/executables/${outName} --config package.json --no-bytecode --public-packages "*"`,
    { stdio: 'inherit' }
  );
}

// Step 3: Build AppImage for Linux
if (targetFlag === 'linux' || targetFlag === 'all') {
  console.log('\n📦 Step 3: Building AppImage...');
  const linuxBin = `dist/executables/contractor-linux-x64-v${VERSION}`;
  const appDir = 'Contractor.AppDir';
  const appImage = `dist/executables/contractor-linux-x64-v${VERSION}.AppImage`;

  // Check appimagetool exists
  try {
    execSync('test -f appimagetool', { stdio: 'ignore' });
  } catch {
    console.log('  Downloading appimagetool...');
    execSync('wget -q "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage" -O appimagetool && chmod +x appimagetool', { stdio: 'inherit' });
  }

  // Create AppDir
  execSync(`rm -rf ${appDir}`, { stdio: 'ignore' });
  mkdirSync(`${appDir}/usr/bin`, { recursive: true });
  mkdirSync(`${appDir}/usr/share/icons/hicolor/256x256/apps`, { recursive: true });

  // Copy binary
  execSync(`cp ${linuxBin} ${appDir}/usr/bin/contractor && chmod +x ${appDir}/usr/bin/contractor`);

  // Icon
  try {
    execSync(`convert assets/logo.png -resize 256x256 ${appDir}/contractor.png 2>/dev/null`);
  } catch {
    // Fallback: generate icon
    execSync(`convert -size 256x256 xc:'#0c0e13' -fill '#00d2b4' -draw "roundrectangle 24,24 232,232 40,40" -fill '#0c0e13' -font 'Helvetica-Bold' -pointsize 140 -gravity center -draw "text 0,0 'C'" ${appDir}/contractor.png`);
  }
  execSync(`cp ${appDir}/contractor.png ${appDir}/usr/share/icons/hicolor/256x256/apps/contractor.png`);

  // Desktop file
  writeFileSync(`${appDir}/contractor.desktop`, `[Desktop Entry]
Name=Contractor
GenericName=Freelance Document Manager
Comment=Generate Hebrew quotes and contracts
Exec=contractor
Icon=contractor
Type=Application
Terminal=false
Categories=Office;Finance;
StartupNotify=false
`);

  // AppRun
  writeFileSync(`${appDir}/AppRun`, `#!/bin/sh
SELF=$(readlink -f "$0")
HERE=\${SELF%/*}
export PATH="\${HERE}/usr/bin/:\${PATH:+:\$PATH}"
unset XDG_DATA_DIRS
if [ "\$1" = "--mcp" ]; then
  exec "\${HERE}/usr/bin/contractor" "\$@"
fi
# Start server in background, wait for it, then open browser
"\${HERE}/usr/bin/contractor" "$@" &
SERVER_PID=$!
sleep 2
xdg-open "http://localhost:6831" 2>/dev/null || true
wait $SERVER_PID
`);
  execSync(`chmod +x ${appDir}/AppRun`);

  // Build
  execSync(`ARCH=x86_64 ./appimagetool ${appDir} ${appImage}`, { stdio: 'inherit' });
  execSync(`rm -rf ${appDir}`);
  console.log(`✅ AppImage created: ${appImage}`);
}

console.log('\n✅ Done! Executables in dist/executables/');
