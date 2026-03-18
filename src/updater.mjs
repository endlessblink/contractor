import { createWriteStream, existsSync, renameSync, chmodSync, unlinkSync } from 'fs';

const GITHUB_REPO = 'endlessblink/contractor';
export const CURRENT_VERSION = '1.0.0';

function getPlatformSuffix() {
  const { platform, arch } = process;
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (platform === 'win32') return 'win-x64.exe';
  return 'linux-x64';
}

export async function checkForUpdate(silent = false) {
  if (typeof process.pkg === 'undefined') return;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { 'User-Agent': 'contractor-updater' } }
    );
    if (!res.ok) return;

    const release = await res.json();
    const latest = release.tag_name?.replace(/^v/, '');
    if (!latest || latest === CURRENT_VERSION) {
      if (!silent) console.log(`✓ Up to date (v${CURRENT_VERSION})`);
      return;
    }

    console.log(`\n🆕 Update available: v${CURRENT_VERSION} → v${latest}`);
    const suffix = getPlatformSuffix();
    const asset = release.assets?.find(a => a.name.includes(suffix));
    if (!asset) { console.log('No binary for your platform.'); return; }

    console.log('Downloading update...');
    const dlRes = await fetch(asset.browser_download_url);
    if (!dlRes.ok) return;

    const tmpPath = process.execPath + '.new';
    const writer = createWriteStream(tmpPath);
    await new Promise((resolve, reject) => {
      dlRes.body.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const backupPath = process.execPath + '.old';
    if (existsSync(backupPath)) { try { unlinkSync(backupPath); } catch {} }
    renameSync(process.execPath, backupPath);
    renameSync(tmpPath, process.execPath);
    try { chmodSync(process.execPath, 0o755); } catch {}

    console.log(`✅ Updated to v${latest}. Restart the app.`);
  } catch {
    // Never crash on update failure
  }
}
