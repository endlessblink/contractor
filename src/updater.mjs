import { createWriteStream, existsSync, renameSync, chmodSync, unlinkSync, statSync } from 'fs';
import path from 'path';

const GITHUB_REPO = 'endlessblink/contractor';
export const CURRENT_VERSION = '1.8.0';

function getPlatformSuffix() {
  const { platform, arch } = process;
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (platform === 'win32') return 'win-x64.exe';
  return 'linux-x64';
}

/** Check GitHub for a newer release. Returns { current, latest, url, asset } or null if up to date. */
export async function checkUpdateAvailable() {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    { headers: { 'User-Agent': 'contractor-updater' }, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error('GitHub API returned HTTP ' + res.status);

  const release = await res.json();
  const latest = release.tag_name?.replace(/^v/, '');
  if (!latest || latest === CURRENT_VERSION) return null; // up to date

  const suffix = getPlatformSuffix();
  const asset = release.assets?.find(a => a.name.includes(suffix));
  const url = 'https://github.com/' + GITHUB_REPO + '/releases/tag/v' + latest;

  return { current: CURRENT_VERSION, latest, url, asset: asset || null };
}

/** Download the update binary and atomically replace the current exe. */
export async function downloadAndInstall(asset) {
  if (!asset || !asset.browser_download_url) {
    throw new Error('No download URL available for this platform');
  }

  const execDir = path.dirname(process.execPath);
  const tmpPath = path.join(execDir, '.contractor-update.tmp');
  const oldPath = process.execPath + '.old';

  // Step 1: Download to temp file in SAME directory as exe
  console.log('Downloading update (' + ((asset.size || 0) / 1024 / 1024).toFixed(0) + ' MB)...');
  const dlRes = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(300000) });
  if (!dlRes.ok) throw new Error('Download failed (HTTP ' + dlRes.status + ')');

  const writer = createWriteStream(tmpPath);
  const reader = dlRes.body.getReader();
  let downloaded = 0;
  const totalBytes = parseInt(dlRes.headers.get('content-length') || asset.size || 0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writer.write(value);
    downloaded += value.length;
  }
  await new Promise((resolve, reject) => {
    writer.end();
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  // Step 2: Verify download size
  const stat = statSync(tmpPath);
  if (totalBytes > 0 && stat.size < totalBytes * 0.9) {
    unlinkSync(tmpPath);
    throw new Error('Download incomplete (' + stat.size + '/' + totalBytes + ' bytes)');
  }

  // Step 3: Set executable permission (macOS/Linux)
  if (process.platform !== 'win32') {
    chmodSync(tmpPath, 0o755);
  }

  // Step 4: Atomic swap
  try {
    if (process.platform === 'win32') {
      // Windows: can't delete running exe, but CAN rename it
      if (existsSync(oldPath)) { try { unlinkSync(oldPath); } catch {} }
      renameSync(process.execPath, oldPath);
      renameSync(tmpPath, process.execPath);
    } else {
      // Linux/macOS: atomic rename works on running binaries (POSIX)
      renameSync(tmpPath, process.execPath);
    }
  } catch (err) {
    // Rollback: restore old binary if swap failed
    try { if (existsSync(oldPath) && !existsSync(process.execPath)) renameSync(oldPath, process.execPath); } catch {}
    try { unlinkSync(tmpPath); } catch {}
    throw new Error('Failed to replace binary: ' + err.message);
  }

  return { success: true, message: 'Update applied. Please restart the app.' };
}

/** Check for update at startup. Stores result in global._updateAvailable for the UI — does NOT auto-download. */
export async function checkForUpdate(silent = false) {
  if (typeof process.pkg === 'undefined') return;

  // Clean up any .old file from a previous update
  const oldPath = process.execPath + '.old';
  if (existsSync(oldPath)) { try { unlinkSync(oldPath); } catch {} }

  try {
    const info = await checkUpdateAvailable();
    if (!info) { if (!silent) console.log('Up to date (v' + CURRENT_VERSION + ')'); return; }
    console.log('Update available: v' + info.current + ' -> v' + info.latest);
    // Store for the UI to pick up — don't auto-download
    global._updateAvailable = info;
  } catch (err) {
    if (!silent) console.log('Update check failed: ' + (err.message || err));
  }
}
